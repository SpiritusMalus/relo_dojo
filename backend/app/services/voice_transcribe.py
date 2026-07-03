"""Read-aloud transcription (voice mode a): audio bytes → verbatim text, routed by LLM_PROVIDER.

Two transports share one verbatim instruction; the binary pass/fail compare lives on the CLIENT
(services/voice gradeReadAloud) — here we only return a faithful transcript:
- "openrouter" — OpenRouter Chat Completions with an `input_audio` content part (OPENROUTER_TRANSCRIBE_MODEL).
- "gemini" (and the default) — Google generateContent with an `inline_data` audio part (GEMINI_MODEL).

No live key is needed to build or unit-test this — the provider HTTP call is mocked in tests.
"""

from __future__ import annotations

import base64

from ..core.config import settings
from .llm import (
    GEMINI_BASE,
    OPENROUTER_URL,
    LLMError,
    _post,
    _require_key,
    parse_gemini_response,
    parse_openai_response,
    with_openrouter_prefs,
)

# Verbatim-only instruction: no commentary, no translation, no correction — just what was said.
_TRANSCRIBE_INSTRUCTION = (
    "Transcribe this audio verbatim. Return ONLY the spoken words as plain text — no commentary, "
    "no translation, no quotation marks, no labels."
)

# OpenRouter's input_audio wants a bare format token (wav/mp3/m4a/…), not a MIME type. Map the few
# that differ; otherwise take the subtype after the slash ("audio/m4a" -> "m4a").
_FORMAT_ALIASES = {"mpeg": "mp3", "x-m4a": "m4a", "mp4": "m4a", "x-wav": "wav"}


def _instruction(lang: str | None) -> str:
    return _TRANSCRIBE_INSTRUCTION + (f" The speaker is practicing in language: {lang}." if lang else "")


def _audio_format(mime: str) -> str:
    sub = (mime or "").split("/")[-1].strip().lower()
    return _FORMAT_ALIASES.get(sub, sub or "wav")


def build_transcribe_payload(audio_b64: str, mime: str, lang: str | None = None) -> dict:
    """Gemini generateContent body with an inline audio part + the verbatim instruction (pure)."""
    return {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": audio_b64}},
                    {"text": _instruction(lang)},
                ]
            }
        ],
        "generationConfig": {"maxOutputTokens": settings.LLM_MAX_TOKENS, "temperature": 0},
    }


def build_openrouter_transcribe_payload(audio_b64: str, mime: str, lang: str | None = None) -> dict:
    """OpenRouter Chat Completions body with an input_audio part + the verbatim instruction (pure).
    Verbatim transcription needs no thinking either — the reasoning knob applies here too."""
    return with_openrouter_prefs({
        "model": settings.OPENROUTER_TRANSCRIBE_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": _audio_format(mime)}},
                    {"type": "text", "text": _instruction(lang)},
                ],
            }
        ],
        "max_tokens": settings.LLM_MAX_TOKENS,
        "temperature": 0,
    })


async def transcribe(audio_b64: str, mime: str, lang: str | None = None) -> str:
    """Transcribe a base64 audio clip to verbatim text, routed by LLM_PROVIDER. Raises LLMError on a
    provider problem (mapped to HTTP by the router)."""
    # Validate the base64 up front so a malformed upload fails clearly rather than at the provider.
    try:
        base64.b64decode(audio_b64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise LLMError("Audio payload is not valid base64.") from exc

    provider = (settings.LLM_PROVIDER or "ollama").strip().lower()
    if provider == "openrouter":
        key = _require_key(settings.OPENROUTER_API_KEY, "OPENROUTER_API_KEY", "openrouter")
        headers = {"Authorization": f"Bearer {key}"}
        payload = build_openrouter_transcribe_payload(audio_b64, mime, lang)
        data = await _post(OPENROUTER_URL, headers, payload, "OpenRouter")
        return str(parse_openai_response(data, expect_json=False) or "").strip()

    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    headers = {"x-goog-api-key": key}
    url = f"{GEMINI_BASE}/models/{settings.GEMINI_MODEL}:generateContent"
    data = await _post(url, headers, build_transcribe_payload(audio_b64, mime, lang), "Gemini")
    return str(parse_gemini_response(data, expect_json=False) or "").strip()
