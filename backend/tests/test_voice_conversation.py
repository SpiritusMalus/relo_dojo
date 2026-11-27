import asyncio
import base64
import io
import json
import struct
import threading
import uuid
import wave
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.core.ratelimit import SlidingWindowLimiter
from app.core.security import create_access_token, create_verify_token
from app.main import app
from app.routers import voice_conversation as route
from app.services import http_client, voice_conversation as voice

TURN = voice.ConversationTurn(
    "I went to work.",
    [{"original": "go", "replacement": "went", "explanation": "Действие в прошлом."}],
    "How was your day?",
)
SOUND = struct.pack("<h", 2000) * (voice.FRAME_BYTES // 2)
SILENCE = bytes(voice.FRAME_BYTES)


@pytest.fixture
def socket_client(monkeypatch):
    user = SimpleNamespace(id=uuid.uuid4(), pd_consent_at=datetime.now(timezone.utc))

    class Database:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, _table, user_id):
            return user if user.id == user_id else None

    monkeypatch.setattr(settings, "VOICE_CONVERSATION_ENABLED", True)
    monkeypatch.setattr(settings, "VOICE_ENABLED", False)
    monkeypatch.setattr(settings, "AUTO_MIGRATE", False)
    monkeypatch.setattr(settings, "EVENTS_TTL_DAYS", 0)
    monkeypatch.setattr(route, "SessionLocal", Database)
    route._connections.reset()
    route._turns.reset()
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client, {"Authorization": f"Bearer {create_access_token(str(user.id))}"}, user


def _start(ws):
    ws.send_json({"type": "start", "consent": route.CONSENT_VERSION})
    assert ws.receive_json() == {"type": "ready"}


def _audio(ws, pcm):
    ws.send_json({"type": "audio", "data": base64.b64encode(pcm).decode("ascii")})


def _utterance(ws):
    _audio(ws, SOUND * 20)
    _audio(ws, SILENCE * 34)
    assert ws.receive_json() == {"type": "speech_start"}
    assert ws.receive_json() == {"type": "thinking"}


def _finish(ws):
    assert ws.receive_json() == {"type": "feedback", "transcript": "I go to work.",
                                 "corrected": TURN.corrected, "corrections": TURN.corrections}
    assert ws.receive_json() == {"type": "reply", "text": TURN.reply}
    assert ws.receive_json() == {"type": "audio", "data": "AAECAw=="}
    assert ws.receive_json() == {"type": "done"}


@pytest.fixture
def providers(monkeypatch):
    transcribe = AsyncMock(return_value="I go to work.")
    respond = AsyncMock(return_value=TURN)

    async def speak(reply):
        assert reply == TURN.reply
        yield b"\x00\x01\x02\x03"

    monkeypatch.setattr(voice, "transcribe", transcribe)
    monkeypatch.setattr(voice, "respond", respond)
    monkeypatch.setattr(voice, "speak", speak)
    return transcribe, respond


@pytest.mark.parametrize("fault, expected, close_code", [
    ("disabled", "voice_disabled", 4404),
    ("missing_token", "auth_required", 4401),
    ("verification_token", "auth_required", 4401),
    ("missing_account_consent", "consent_required", 4403),
    ("missing_voice_opt_in", "consent_required", 4403),
])
def test_voice_requires_its_own_flag_access_token_and_consent(
    monkeypatch, socket_client, providers, fault, expected, close_code,
):
    client, headers, user = socket_client
    if fault == "disabled":
        monkeypatch.setattr(settings, "VOICE_CONVERSATION_ENABLED", False)
        monkeypatch.setattr(settings, "VOICE_ENABLED", True)
    if fault == "missing_token":
        headers = {}
    if fault == "verification_token":
        headers = {"Authorization": f"Bearer {create_verify_token(str(user.id))}"}
    if fault == "missing_account_consent":
        user.pd_consent_at = None
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        if fault == "missing_voice_opt_in":
            ws.send_json({"type": "start"})
        assert ws.receive_json() == {"type": "error", "code": expected}
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == close_code
    providers[0].assert_not_called()


@pytest.mark.parametrize("startup_timeout, auth_timeout", [(1, 0.04), (0.04, 1)])
def test_startup_and_auth_deadlines_cancel_account_lookup(
    monkeypatch, socket_client, providers, startup_timeout, auth_timeout,
):
    client, headers, user = socket_client
    cancelled = threading.Event()
    real_get_user = route.get_current_user

    async def stuck_lookup(*_):
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    monkeypatch.setattr(route, "_START_TIMEOUT", startup_timeout)
    monkeypatch.setattr(route, "_AUTH_TIMEOUT", auth_timeout)
    monkeypatch.setattr(route, "get_current_user", stuck_lookup)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        assert ws.receive_json() == {"type": "error", "code": "startup_timeout"}
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4408
    assert cancelled.is_set() and str(user.id) not in route._active
    providers[0].assert_not_called()

    monkeypatch.setattr(route, "_START_TIMEOUT", 1)
    monkeypatch.setattr(route, "_AUTH_TIMEOUT", 1)
    monkeypatch.setattr(route, "get_current_user", real_get_user)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)


def test_consent_frame_timeout_releases_already_reserved_slot(monkeypatch, socket_client, providers):
    client, headers, user = socket_client
    seen_user = []
    real_receive = route._receive

    async def check_slot(socket, timeout=None):
        if timeout is None:
            seen_user.append(str(user.id) in route._active)
        return await real_receive(socket, timeout)

    monkeypatch.setattr(route, "_receive", check_slot)
    monkeypatch.setattr(route, "_START_TIMEOUT", 0.1)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        assert ws.receive_json() == {"type": "error", "code": "startup_timeout"}
    assert seen_user == [True]
    assert str(user.id) not in route._active
    providers[0].assert_not_called()

    monkeypatch.setattr(route, "_START_TIMEOUT", 1)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)


def test_global_capacity_remains_distinct_from_an_active_account(monkeypatch, socket_client, providers):
    client, headers, _ = socket_client
    monkeypatch.setattr(route, "_MAX_SESSIONS", 1)
    monkeypatch.setattr(route, "_active", {"another-account"})
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        assert ws.receive_json() == {"type": "error", "code": "voice_busy"}
    assert route._active == {"another-account"}
    providers[0].assert_not_called()


def test_connection_limit_includes_retry_seconds(monkeypatch, socket_client, providers):
    client, headers, _ = socket_client
    monkeypatch.setattr(route, "_connections", SlidingWindowLimiter(1, 60))
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        error = ws.receive_json()
        assert error["type"] == "error" and error["code"] == "connection_rate_limit"
        assert type(error["retryAfterSeconds"]) is int and 0 < error["retryAfterSeconds"] <= 60
    providers[0].assert_not_called()


@pytest.mark.parametrize("session_limited", [True, False])
def test_session_and_rolling_turn_limits_have_distinct_errors(
    monkeypatch, socket_client, providers, session_limited,
):
    client, headers, _ = socket_client
    if session_limited:
        monkeypatch.setattr(route, "_MAX_TURNS", 1)
    else:
        monkeypatch.setattr(route, "_turns", SlidingWindowLimiter(1, 3600))
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        _utterance(ws)
        _finish(ws)
        _audio(ws, SOUND * 20)
        _audio(ws, SILENCE * 34)
        assert ws.receive_json() == {"type": "speech_start"}
        error = ws.receive_json()
        if session_limited:
            assert error == {"type": "error", "code": "session_limit"}
        else:
            assert error["type"] == "error" and error["code"] == "turn_rate_limit"
            assert type(error["retryAfterSeconds"]) is int and 0 < error["retryAfterSeconds"] <= 3600
    providers[0].assert_awaited_once()


def test_continuous_microphone_turn_returns_feedback_and_streamed_reply(socket_client, providers):
    client, headers, _ = socket_client
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        _audio(ws, SILENCE * 10)
        _utterance(ws)
        _finish(ws)
        # The client can still be draining playback after the server has finished sending.
        ws.send_json({"type": "interrupt"})
        assert ws.receive_json() == {"type": "interrupted"}
    providers[0].assert_awaited_once()
    providers[1].assert_awaited_once()
    assert SOUND in providers[0].await_args.args[0]


def test_inaudible_transcript_skips_feedback_and_resumes_listening(socket_client, providers):
    client, headers, _ = socket_client
    providers[0].side_effect = ["", "I go to work."]
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        _utterance(ws)
        assert ws.receive_json() == {"type": "done"}
        _utterance(ws)
        _finish(ws)
    providers[1].assert_awaited_once()


def test_interrupt_cancels_provider_work_and_the_same_socket_accepts_another_turn(
    monkeypatch, socket_client, providers,
):
    client, headers, _ = socket_client
    started, stopped = threading.Event(), threading.Event()
    count = 0

    async def transcribe(_):
        nonlocal count
        count += 1
        if count == 1:
            started.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()
        return "I go to work."

    monkeypatch.setattr(voice, "transcribe", transcribe)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        _utterance(ws)
        assert started.wait(2)
        _audio(ws, SOUND * 3)  # An in-flight mic frame must not initiate a paid turn.
        ws.send_json({"type": "interrupt"})
        assert ws.receive_json() == {"type": "interrupted"}
        assert stopped.is_set()
        _utterance(ws)
        _finish(ws)
    assert count == 2
    providers[1].assert_awaited_once()


def test_disconnect_cancels_provider_and_releases_duplicate_account_guard(
    monkeypatch, socket_client, providers,
):
    client, headers, _ = socket_client
    started, stopped = threading.Event(), threading.Event()

    async def transcribe(_):
        started.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()

    monkeypatch.setattr(voice, "transcribe", transcribe)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        _utterance(ws)
        assert started.wait(2)
        with client.websocket_connect("/voice/conversation", headers=headers) as duplicate:
            assert duplicate.receive_json() == {"type": "error", "code": "voice_already_active"}
    assert stopped.wait(2)
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
    providers[1].assert_not_called()


@pytest.mark.parametrize("frame, outcome", [
    ({"type": "audio", "data": "@"}, "invalid_audio"),
    ({"type": "audio", "data": "YQ=="}, "invalid_audio"),
    ({"type": "audio", "data": "A" * 48_001}, "message_too_large"),
])
def test_invalid_pcm_cannot_reach_a_provider(socket_client, providers, frame, outcome):
    client, headers, _ = socket_client
    with client.websocket_connect("/voice/conversation", headers=headers) as ws:
        _start(ws)
        ws.send_json(frame)
        assert ws.receive_json() == {"type": "error", "code": outcome}
    providers[0].assert_not_called()


@pytest.mark.asyncio
async def test_audio_provider_requests_are_wav_in_and_streamed_pcm_out(monkeypatch):
    requests = []

    def handle(request):
        requests.append(request)
        if request.url.path.endswith("/transcriptions"):
            return httpx.Response(200, json={"text": "I go to work.", "usage": {}})
        if request.url.path.endswith("/completions"):
            content = json.dumps(dict(corrected=TURN.corrected, corrections=TURN.corrections, reply=TURN.reply))
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})
        return httpx.Response(200, headers={"content-type": "audio/pcm"}, content=b"\x01\x02" * 3000)

    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "offline-synthetic-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(http_client, "client", lambda: client)
        transcript = await voice.transcribe(SOUND)
        assert await voice.respond(transcript, [("Hello", "Hi!")]) == TURN
        chunks = [chunk async for chunk in voice.speak(TURN.reply)]

    assert [r.url.path for r in requests] == ["/api/v1/audio/transcriptions", "/api/v1/chat/completions",
                                              "/api/v1/audio/speech"]
    assert all(r.headers["Authorization"] == "Bearer offline-synthetic-key" for r in requests)
    transcription, chat, speech = (json.loads(r.content) for r in requests)
    assert transcription["language"] == "en" and transcription["input_audio"]["format"] == "wav"
    with wave.open(io.BytesIO(base64.b64decode(transcription["input_audio"]["data"]))) as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16_000)
        assert audio.readframes(audio.getnframes()) == SOUND
    assert chat["messages"][-1] == {"role": "user", "content": transcript}
    assert chat["messages"][-2] == {"role": "assistant", "content": "Hi!"}
    assert chat["response_format"]["type"] == "json_schema"
    assert speech["provider"]["options"]["elevenlabs"]["output_format"] == "pcm_24000"
    assert speech["response_format"] == "pcm" and [len(chunk) for chunk in chunks] == [4096, 1904]
