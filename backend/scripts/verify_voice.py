#!/usr/bin/env python3
"""Live voice-link check — does the Gemini key actually support the voice paths?

Voice mode reuses GEMINI_API_KEY directly (independent of LLM_PROVIDER). The fragile, key/project-
dependent bits are the Live path, so this script exercises them for real:

  1) resolve_live_model() — lists the key's models and picks a native-audio flash-live id.
     Fails with "No Gemini live model available" if the project has no such model.
  2) mint_live_token()    — mints a short-lived EPHEMERAL Live token via v1alpha/auth_tokens.
     This is the make-or-break for realtime voice: it needs Live ephemeral-token API access.

It never prints the raw GEMINI_API_KEY, and only shows a short prefix of the ephemeral token
(itself a credential) — enough to confirm one was minted without pasting it whole.

The read-aloud /voice/transcribe path shares the same generateContent plumbing already proven by
verify_llm.py, so it is not re-hit here (it needs a real audio clip to be meaningful).

Note: this checks the Gemini-side capability and does NOT require VOICE_ENABLED — that flag only
gates the HTTP router, not these service calls. Run it before flipping the flag to de-risk the launch.

Usage (from backend/, with .env holding GEMINI_API_KEY):
    python scripts/verify_voice.py

Exit code 0 if both live checks pass, 1 otherwise.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://verify:verify@localhost/verify_unused")
os.environ.setdefault("JWT_SECRET", "verify-unused")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.services import voice_live  # noqa: E402

PASS, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"


async def main() -> int:
    print("\n\033[1mLive voice-link check\033[0m")
    print(f"  api key  : {'set' if settings.GEMINI_API_KEY else chr(27) + '[31mMISSING' + chr(27) + '[0m'} (GEMINI_API_KEY)")
    print(f"  voice flag (router gate, not needed for this check) : VOICE_ENABLED={settings.VOICE_ENABLED}")
    print()

    failures = 0

    # 1) native-audio live model resolution
    model = None
    try:
        model = await voice_live.resolve_live_model()
        print(f"  {PASS} resolve_live_model() → {model}")
    except Exception as exc:
        failures += 1
        print(f"  {FAIL} resolve_live_model() → {type(exc).__name__}: {exc}")

    # 2) ephemeral Live token minting (the realtime make-or-break)
    try:
        token, expires_at = await voice_live.mint_live_token()
        # token is a credential — show only a short prefix + length, never the whole value.
        shown = (token[:18] + "…") if len(token) > 18 else token
        print(f"  {PASS} mint_live_token()    → {shown} (len={len(token)}), expires {expires_at}")
    except Exception as exc:
        failures += 1
        print(f"  {FAIL} mint_live_token()    → {type(exc).__name__}: {exc}")

    print()
    if failures:
        print(f"\033[31m{failures} voice check(s) FAILED\033[0m — realtime voice will not work yet.\n")
        return 1
    print(f"\033[32mVoice link is live\033[0m — native-audio model + ephemeral token both work.\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
