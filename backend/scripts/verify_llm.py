#!/usr/bin/env python3
"""Live LLM-link check — does the configured provider actually answer?

The unit suite covers llm.py's payload builders/parsers offline with no network. This script
closes the last gap: it makes TWO REAL calls through the same `llm.generate` / `llm.generate_json`
surface the app uses, against whatever LLM_PROVIDER points at (gemini in prod). No DB, no running
server — just config + the provider's HTTP API.

It never prints the API key (only whether one is set), so it's safe to paste output anywhere.

Usage (from backend/, with .env holding LLM_PROVIDER + the provider's API key):
    python scripts/verify_llm.py

Exit code 0 if both calls succeed, 1 otherwise — usable as a deploy gate.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# config.py instantiates Settings() at import and requires these two secrets; the LLM path never
# touches the DB, so a dummy DATABASE_URL/JWT_SECRET is fine when they aren't already in .env.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://verify:verify@localhost/verify_unused")
os.environ.setdefault("JWT_SECRET", "verify-unused")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.services import llm  # noqa: E402

PASS, FAIL = "\033[32m✓\033[0m", "\033[31m✗\033[0m"

# Key env var per provider, so we can report key-presence (never the value).
_KEY_ATTR = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
}


async def main() -> int:
    provider = (settings.LLM_PROVIDER or "ollama").strip().lower()
    model = llm.active_model()
    print(f"\n\033[1mLive LLM-link check\033[0m")
    print(f"  provider : {provider}")
    print(f"  model    : {model}")
    if provider in _KEY_ATTR:
        key_set = bool(getattr(settings, _KEY_ATTR[provider], ""))
        key_state = "set" if key_set else "\033[31mMISSING\033[0m"
        print(f"  api key  : {key_state} ({_KEY_ATTR[provider]})")
    elif provider == "ollama":
        print(f"  endpoint : {settings.OLLAMA_URL}")
    print()

    failures = 0

    # 1) plain free-text generation (the /story, /explain, /review-text path)
    try:
        text = await llm.generate(
            "Reply with exactly the word: pong", temperature=0.0
        )
        snippet = " ".join(text.split())[:80]
        print(f"  {PASS} generate()        → {snippet!r}")
    except Exception as exc:  # LLMError or anything unexpected — surface it, don't crash
        failures += 1
        print(f"  {FAIL} generate()        → {type(exc).__name__}: {exc}")

    # 2) structured JSON (the /exercise + agent path — forced schema adherence)
    schema = {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}, "word": {"type": "string"}},
        "required": ["ok", "word"],
    }
    try:
        data = await llm.generate_json(
            'Return JSON with ok=true and word="ping".', schema, temperature=0.0
        )
        print(f"  {PASS} generate_json()   → {data}")
        if not isinstance(data, dict):
            failures += 1
            print(f"  {FAIL} generate_json() returned a non-object: {type(data).__name__}")
    except Exception as exc:
        failures += 1
        print(f"  {FAIL} generate_json()   → {type(exc).__name__}: {exc}")

    print()
    if failures:
        print(f"\033[31m{failures} call(s) FAILED\033[0m — the LLM link is not working.\n")
        return 1
    print(f"\033[32mLLM link is live\033[0m — {provider}/{model} answered both calls.\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
