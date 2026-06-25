#!/usr/bin/env python3
"""Live voice-link check — does the configured provider actually do voice?

Routed by LLM_PROVIDER (voice reuses the same key as text):

- "openrouter" — the only voice path is read-aloud transcription (Chat Completions input_audio).
  This synthesizes a tiny silent WAV and sends it through voice_transcribe.transcribe(): a 200 with
  any/empty transcript proves auth + model + audio format are accepted. (Realtime Live dialog does
  NOT exist on OpenRouter — nothing to check.)
- "gemini" — exercises the two key/project-dependent Live bits: resolve_live_model() and
  mint_live_token() (the v1alpha ephemeral-token path).

Never prints the raw API key (only a short prefix of a minted ephemeral token, itself a credential).
Independent of VOICE_ENABLED — that flag only gates the HTTP router, not these service calls.

Usage (from backend/, with .env holding the provider's key):
    python scripts/verify_voice.py

Exit code 0 if the checks pass, 1 otherwise.
"""

from __future__ import annotations

import asyncio
import base64
import os
import struct
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://verify:verify@localhost/verify_unused")
os.environ.setdefault("JWT_SECRET", "verify-unused")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402

PASS, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"


def _tiny_wav_b64() -> str:
    """0.1s of 16 kHz mono 16-bit silence as a valid WAV, base64 — enough to prove the audio path."""
    sr, frames = 16000, 1600
    data = b"\x00\x00" * frames
    header = (
        b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
        + b"data" + struct.pack("<I", len(data))
    )
    return base64.b64encode(header + data).decode()


async def _check_openrouter() -> int:
    from app.services import voice_transcribe

    print(f"  model    : {settings.OPENROUTER_TRANSCRIBE_MODEL} (transcription)")
    print(f"  api key  : {'set' if settings.OPENROUTER_API_KEY else chr(27) + '[31mMISSING' + chr(27) + '[0m'} (OPENROUTER_API_KEY)\n")
    try:
        transcript = await voice_transcribe.transcribe(_tiny_wav_b64(), "audio/wav", "en")
        print(f"  {PASS} transcribe() (read-aloud) → accepted; transcript={transcript!r}")
        print(f"\n\033[32mVoice (read-aloud) link is live\033[0m via OpenRouter.\n")
        return 0
    except Exception as exc:
        print(f"  {FAIL} transcribe() (read-aloud) → {type(exc).__name__}: {exc}")
        print(f"\n\033[31mread-aloud FAILED\033[0m — check OPENROUTER_API_KEY and that "
              f"{settings.OPENROUTER_TRANSCRIBE_MODEL} accepts audio input.\n")
        return 1


async def _check_gemini() -> int:
    from app.services import voice_live

    print(f"  api key  : {'set' if settings.GEMINI_API_KEY else chr(27) + '[31mMISSING' + chr(27) + '[0m'} (GEMINI_API_KEY)\n")
    failures = 0
    try:
        model = await voice_live.resolve_live_model()
        print(f"  {PASS} resolve_live_model() → {model}")
    except Exception as exc:
        failures += 1
        print(f"  {FAIL} resolve_live_model() → {type(exc).__name__}: {exc}")
    try:
        token, expires_at = await voice_live.mint_live_token()
        shown = (token[:18] + "…") if len(token) > 18 else token
        print(f"  {PASS} mint_live_token()    → {shown} (len={len(token)}), expires {expires_at}")
    except Exception as exc:
        failures += 1
        print(f"  {FAIL} mint_live_token()    → {type(exc).__name__}: {exc}")
    print(f"\n{'✅ Voice link is live' if not failures else '❌ ' + str(failures) + ' voice check(s) FAILED'}\n")
    return 1 if failures else 0


async def main() -> int:
    provider = (settings.LLM_PROVIDER or "ollama").strip().lower()
    print(f"\n\033[1mLive voice-link check\033[0m")
    print(f"  provider : {provider}")
    print(f"  voice flag (router gate, not needed here): VOICE_ENABLED={settings.VOICE_ENABLED}")
    if provider == "openrouter":
        return await _check_openrouter()
    if provider == "gemini":
        return await _check_gemini()
    print(f"\n  voice checks only apply to the openrouter or gemini providers (got {provider!r}).\n")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
