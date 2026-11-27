"""Bounded audio turn detection and OpenRouter conversation providers."""

from __future__ import annotations

import base64
import io
import struct
import wave
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass

from ..core.config import settings
from . import http_client, llm

MIC_RATE = 16_000
MIC_BYTES_PER_SECOND = MIC_RATE * 2
PLAYBACK_BYTES_PER_SECOND = 24_000 * 2
FRAME_BYTES = MIC_BYTES_PER_SECOND // 50  # 20 ms of little-endian PCM16
_OPENROUTER_AUDIO_URL = "https://openrouter.ai/api/v1/audio"
_TEXT_LIMIT = 1200
_REPLY_LIMIT = 300
_HISTORY_TURNS = 4


class SpeechTurnDetector:
    """Detect a speech onset and an end pause independently of microphone chunk boundaries."""

    def __init__(self) -> None:
        self._chunk = bytearray()
        self._preroll: deque[bytes] = deque(maxlen=10)
        self._turn: bytearray | None = None
        self._voiced = 0
        self._silence = 0

    def feed(self, pcm: bytes) -> tuple[bool, bytes | None]:
        """Return an onset flag and completed PCM. Empty PCM indicates too little speech."""
        self._chunk.extend(pcm)
        started = False
        consumed = len(self._chunk) // FRAME_BYTES * FRAME_BYTES
        for offset in range(0, consumed, FRAME_BYTES):
            frame = bytes(self._chunk[offset:offset + FRAME_BYTES])
            energy = sum(sample * sample for (sample,) in struct.iter_unpack("<h", frame))
            voiced = energy >= (FRAME_BYTES // 2) * 350**2
            if self._turn is None:
                self._preroll.append(frame)
                self._voiced = self._voiced + 1 if voiced else 0
                if self._voiced >= 3:
                    self._turn = bytearray(b"".join(self._preroll))
                    started = True
                continue

            self._turn.extend(frame)
            self._voiced += int(voiced)
            self._silence = 0 if voiced else self._silence + 1
            if self._silence >= 32 or len(self._turn) >= 20 * MIC_BYTES_PER_SECOND:
                trailing = max(0, self._silence - 6) * FRAME_BYTES
                end = len(self._turn) - trailing
                completed = bytes(self._turn[:end]) if self._voiced >= 8 else b""
                self._chunk.clear()
                self._preroll.clear()
                self._turn = None
                self._voiced = self._silence = 0
                return started, completed

        del self._chunk[:consumed]
        return started, None


def _wav(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, MIC_RATE, 0, "NONE", "not compressed"))
        audio.writeframes(pcm)
    return output.getvalue()


def _headers() -> dict[str, str]:
    key = llm._require_key(settings.OPENROUTER_API_KEY, "OPENROUTER_API_KEY", "openrouter")
    return {"Authorization": f"Bearer {key}"}


async def transcribe(pcm: bytes) -> str:
    payload = {
        "model": settings.VOICE_CONVERSATION_STT_MODEL,
        "input_audio": {"data": base64.b64encode(_wav(pcm)).decode("ascii"), "format": "wav"},
        "language": "en",
        "temperature": 0,
        "provider": {"options": {"openai": {
            "prompt": "Verbatim learner speech, including repetitions, hesitations, and grammatical mistakes."
        }}},
    }
    result = await llm._post(
        f"{_OPENROUTER_AUDIO_URL}/transcriptions", _headers(), payload, "OpenRouter STT",
        log_error_body=False,
    )
    text = result.get("text")
    if not isinstance(text, str):
        raise llm.LLMOutputError("Invalid speech transcription.")
    return text.strip()[:_TEXT_LIMIT]


_CORRECTION_FIELDS = ("original", "replacement", "explanation")
_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["corrected", "corrections", "reply"],
    "properties": {
        "corrected": {"type": "string"},
        "corrections": {"type": "array", "items": {
            "type": "object",
            "required": list(_CORRECTION_FIELDS),
            "properties": {field: {"type": "string"} for field in _CORRECTION_FIELDS},
        }},
        "reply": {"type": "string"},
    },
}

_INSTRUCTIONS = (
    "You are a friendly English conversation tutor. Continue a natural dialogue in English. "
    "Reply to what the learner meant in one or two short spoken sentences, at most 35 words, and "
    "ask at most one simple relevant question. Keep the reply separate from corrections. "
    "Correct only clear grammar mistakes in the latest utterance. Give up to three corrections, "
    "each with an exact original fragment, its English replacement, and a short explanation in Russian. "
    "The corrected utterance must retain the original meaning. Do not flag punctuation, capitalization, "
    "speech disfluencies, transcription uncertainty, or stylistic preferences. If there is no clear "
    "mistake, use an empty corrections list and copy the utterance into corrected."
)


@dataclass(frozen=True)
class ConversationTurn:
    corrected: str
    corrections: list[dict[str, str]]
    reply: str


async def respond(transcript: str, history: list[tuple[str, str]]) -> ConversationTurn:
    payload = llm.build_openai_payload(transcript, _OUTPUT_SCHEMA, model=settings.OPENROUTER_MODEL)
    messages = [{"role": "system", "content": _INSTRUCTIONS}]
    for learner, tutor in history[-_HISTORY_TURNS:]:
        messages.extend(({"role": "user", "content": learner}, {"role": "assistant", "content": tutor}))
    messages.append({"role": "user", "content": transcript})
    payload.update(messages=messages, max_tokens=min(settings.LLM_MAX_TOKENS, 650))
    result = llm.parse_openai_response(
        await llm._post(llm.OPENROUTER_URL, _headers(), llm.with_openrouter_prefs(payload), "OpenRouter",
                        log_error_body=False),
        expect_json=True,
    )
    llm.validate_json_output(result, _OUTPUT_SCHEMA)
    corrections = []
    for correction in result["corrections"][:3]:
        original, replacement, explanation = (correction[field].strip() for field in _CORRECTION_FIELDS)
        if (original and original in transcript and original.casefold() != replacement.casefold()
                and explanation and max(len(original), len(replacement), len(explanation)) <= 200):
            corrections.append(dict(original=original, replacement=replacement, explanation=explanation))
    corrected = result["corrected"].strip()[:_TEXT_LIMIT] if corrections else transcript
    reply = result["reply"].strip()[:_REPLY_LIMIT]
    if not corrected or not reply:
        raise llm.LLMOutputError("Incomplete conversation response.")
    return ConversationTurn(corrected, corrections, reply)


async def speak(reply: str) -> AsyncIterator[bytes]:
    payload: dict = {
        "model": settings.VOICE_CONVERSATION_TTS_MODEL,
        "input": reply,
        "voice": settings.VOICE_CONVERSATION_TTS_VOICE,
        "response_format": "pcm",
    }
    if settings.VOICE_CONVERSATION_TTS_MODEL.startswith("elevenlabs/"):
        payload["provider"] = {"options": {"elevenlabs": {"output_format": "pcm_24000"}}}
    size = 0
    async with http_client.client().stream(
        "POST", f"{_OPENROUTER_AUDIO_URL}/speech", headers=_headers(), json=payload,
    ) as response:
        llm._raise_for_status(response.status_code, "OpenRouter TTS")
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type not in {"audio/pcm", "application/octet-stream"}:
            raise llm.LLMOutputError("Expected PCM speech audio.")
        async for pcm in response.aiter_bytes(chunk_size=4096):
            size += len(pcm)
            if len(pcm) % 2 or size > 30 * PLAYBACK_BYTES_PER_SECOND:
                raise llm.LLMOutputError("Unexpected speech audio size.")
            yield pcm
    if not size:
        raise llm.LLMOutputError("The speech provider returned no audio.")
