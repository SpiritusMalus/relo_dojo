"""Authenticated, bounded WebSocket for continuous microphone practice."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import time
from contextlib import aclosing, suppress
from threading import Lock
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials

from ..core.config import settings
from ..core.ratelimit import SlidingWindowLimiter
from ..db.base import SessionLocal
from ..deps import get_current_user
from ..services import llm, voice_conversation as voice

router = APIRouter(prefix="/voice", tags=["voice"])
logger = logging.getLogger(__name__)

CONSENT_VERSION = "voice-conversation-v1"
_SESSION_SECONDS = 8 * 60
_TURN_TIMEOUT = 32
_START_TIMEOUT = 8
_IDLE_TIMEOUT = 45
_MAX_TURNS = 24
_MAX_SESSIONS = 6
_MAX_MESSAGES = 30_000
_MAX_FRAME_LENGTH = 48_000
_MAX_AUDIO_BURST = 3 * voice.MIC_BYTES_PER_SECOND
_connections = SlidingWindowLimiter(8, 60)
_turns = SlidingWindowLimiter(60, 60 * 60)
_active: set[str] = set()
_active_lock = Lock()


class SessionError(Exception):
    def __init__(self, code: str, close_code: int = 1008) -> None:
        super().__init__(code)
        self.code = code
        self.close_code = close_code


async def _receive(socket: WebSocket, timeout: float) -> dict[str, Any]:
    frame = await asyncio.wait_for(socket.receive(), timeout)
    if frame["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(frame.get("code", 1000))
    raw = frame.get("text")
    if not isinstance(raw, str):
        raise SessionError("invalid_message")
    if len(raw) > _MAX_FRAME_LENGTH:
        raise SessionError("message_too_large", 1009)
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError) as exc:
        raise SessionError("invalid_message") from exc
    if not isinstance(data, dict):
        raise SessionError("invalid_message")
    return data


def _audio(data: dict[str, Any]) -> bytes:
    encoded = data.get("data")
    if not isinstance(encoded, str):
        raise SessionError("invalid_audio")
    try:
        pcm = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise SessionError("invalid_audio") from exc
    if not pcm or len(pcm) % 2 or len(pcm) > voice.MIC_BYTES_PER_SECOND:
        raise SessionError("invalid_audio")
    return pcm


async def _authenticate(socket: WebSocket) -> str:
    scheme, _, token = socket.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise SessionError("auth_required", 4401)
    async with SessionLocal() as db:
        try:
            user = await get_current_user(HTTPAuthorizationCredentials(scheme=scheme, credentials=token), db)
        except HTTPException as exc:
            raise SessionError("auth_required", 4401) from exc
        if user.pd_consent_at is None:
            raise SessionError("consent_required", 4403)
        return str(user.id)


async def _process_turn(socket: WebSocket, pcm: bytes, history: list[tuple[str, str]]) -> None:
    failure = "transcription_failed"
    try:
        async with asyncio.timeout(_TURN_TIMEOUT):
            transcript = await voice.transcribe(pcm)
            if transcript:
                failure = "response_failed"
                turn = await voice.respond(transcript, history)
                await socket.send_json({"type": "feedback", "transcript": transcript,
                                        "corrected": turn.corrected, "corrections": turn.corrections})
                await socket.send_json({"type": "reply", "text": turn.reply})
                history.append((transcript, turn.reply))
                del history[:-4]
                failure = "speech_failed"
                async with aclosing(voice.speak(turn.reply)) as audio:
                    async for chunk in audio:
                        await socket.send_json({"type": "audio", "data": base64.b64encode(chunk).decode("ascii")})
    except TimeoutError:
        await socket.send_json({"type": "error", "code": "turn_timeout"})
    except (llm.LLMError, httpx.HTTPError, ValueError) as exc:
        logger.warning("Speaking turn failed: %s (%s)", failure, type(exc).__name__)
        await socket.send_json({"type": "error", "code": failure})
    await socket.send_json({"type": "done"})


async def _cancel(task: asyncio.Task[None] | None) -> None:
    if task is not None:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def _serve(socket: WebSocket, user_id: str) -> None:
    detector = voice.SpeechTurnDetector()
    history: list[tuple[str, str]] = []
    active_turn: asyncio.Task[None] | None = None
    turn_count = 0
    last_audio = time.monotonic()
    budget = float(_MAX_AUDIO_BURST)
    await socket.send_json({"type": "ready"})
    try:
        async with asyncio.timeout(_SESSION_SECONDS):
            for _ in range(_MAX_MESSAGES):
                try:
                    data = await _receive(socket, _IDLE_TIMEOUT)
                except TimeoutError as exc:
                    raise SessionError("idle_timeout", 1000) from exc
                if active_turn is not None and active_turn.done():
                    await active_turn
                    active_turn = None
                if data.get("type") == "interrupt":
                    await _cancel(active_turn)
                    active_turn = None
                    detector = voice.SpeechTurnDetector()
                    await socket.send_json({"type": "interrupted"})
                    continue
                if data.get("type") != "audio":
                    raise SessionError("invalid_message")
                pcm = _audio(data)
                now = time.monotonic()
                budget = min(_MAX_AUDIO_BURST, budget + (now - last_audio) * voice.MIC_BYTES_PER_SECOND)
                budget -= len(pcm)
                last_audio = now
                if budget < 0:
                    raise SessionError("audio_rate_limit")
                if active_turn is not None:
                    continue  # Echo and queued mic frames must not become a new paid turn.
                started, completed = detector.feed(pcm)
                if started:
                    await socket.send_json({"type": "speech_start"})
                if completed is None:
                    continue
                if not completed:
                    await socket.send_json({"type": "done"})
                    continue
                if turn_count >= _MAX_TURNS or not _turns.allow(user_id):
                    raise SessionError("turn_limit", 1000)
                turn_count += 1
                await socket.send_json({"type": "thinking"})
                active_turn = asyncio.create_task(_process_turn(socket, completed, history))
            raise SessionError("session_limit", 1000)
    except TimeoutError as exc:
        raise SessionError("session_limit", 1000) from exc
    finally:
        await _cancel(active_turn)


@router.websocket("/conversation")
async def conversation(socket: WebSocket) -> None:
    await socket.accept()
    try:
        if not settings.VOICE_CONVERSATION_ENABLED:
            raise SessionError("voice_disabled", 4404)
        user_id = await _authenticate(socket)
        _connections.gc()
        _turns.gc()
        if not _connections.allow(user_id):
            raise SessionError("connection_rate_limit", 4429)
        with _active_lock:
            if user_id in _active or len(_active) >= _MAX_SESSIONS:
                raise SessionError("voice_busy", 4429)
            _active.add(user_id)
        try:
            try:
                start = await _receive(socket, _START_TIMEOUT)
            except TimeoutError as exc:
                raise SessionError("consent_required", 4403) from exc
            if start.get("type") != "start" or start.get("consent") != CONSENT_VERSION:
                raise SessionError("consent_required", 4403)
            await _serve(socket, user_id)
        finally:
            with _active_lock:
                _active.remove(user_id)
    except (WebSocketDisconnect, OSError):
        return
    except SessionError as exc:
        with suppress(WebSocketDisconnect, OSError):
            await socket.send_json({"type": "error", "code": exc.code})
            await socket.close(code=exc.close_code)
