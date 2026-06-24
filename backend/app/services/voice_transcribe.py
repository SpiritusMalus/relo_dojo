"""Read-aloud transcription (voice mode a): audio bytes → verbatim text via Gemini.

Reuses the text LLM's Gemini plumbing (services/llm: GEMINI_BASE, _post, _require_key, the shared
GEMINI_API_KEY / GEMINI_MODEL) — audio is just an extra `inline_data` part on generateContent. The
binary pass/fail compare lives on the CLIENT (services/voice gradeReadAloud); here we only return a
faithful transcript. No live key is needed to build or unit-test this — Google is mocked in tests.
"""

from __future__ import annotations

import base64

from ..core.config import settings
from .llm import GEMINI_BASE, LLMError, _post, _require_key, parse_gemini_response

# Verbatim-only instruction: no commentary, no translation, no correction — just what was said.
_TRANSCRIBE_INSTRUCTION = (
    "Transcribe this audio verbatim. Return ONLY the spoken words as plain text — no commentary, "
    "no translation, no quotation marks, no labels."
)


def build_transcribe_payload(audio_b64: str, mime: str, lang: str | None = None) -> dict:
    """Gemini generateContent body with an inline audio part + the verbatim instruction (pure)."""
    instruction = _TRANSCRIBE_INSTRUCTION
    if lang:
        instruction += f" The speaker is practicing in language: {lang}."
    return {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": audio_b64}},
                    {"text": instruction},
                ]
            }
        ],
        "generationConfig": {"maxOutputTokens": settings.LLM_MAX_TOKENS, "temperature": 0},
    }


async def transcribe(audio_b64: str, mime: str, lang: str | None = None) -> str:
    """Transcribe a base64 audio clip to verbatim text. Raises LLMError on a provider problem
    (mapped to HTTP by the router). `audio_b64` is passed straight through to Gemini's inline_data."""
    # Validate the base64 up front so a malformed upload fails clearly rather than at the provider.
    try:
        base64.b64decode(audio_b64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise LLMError("Audio payload is not valid base64.") from exc

    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    headers = {"x-goog-api-key": key}
    url = f"{GEMINI_BASE}/models/{settings.GEMINI_MODEL}:generateContent"
    data = await _post(url, headers, build_transcribe_payload(audio_b64, mime, lang), "Gemini")
    return str(parse_gemini_response(data, expect_json=False) or "").strip()
