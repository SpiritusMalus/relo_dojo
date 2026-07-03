#!/usr/bin/env python3
"""Live LLM-link check — does the configured provider actually answer?

The unit suite covers llm.py's payload builders/parsers offline with no network. This script
closes the last gap: it makes TWO REAL calls through the same `llm.generate` / `llm.generate_json`
surface the app uses, against whatever LLM_PROVIDER points at (gemini in prod). No DB, no running
server — just config + the provider's HTTP API.

It never prints the API key (only whether one is set), so it's safe to paste output anywhere.

Usage (from backend/, with .env holding LLM_PROVIDER + the provider's API key):
    python scripts/verify_llm.py
    python scripts/verify_llm.py --bench 5   # + 5 exercise-shaped calls with per-call latency

`--bench N` profiles the real /exercise workload (structured JSON, exercise-style prompt) and
echoes the `llm ok` telemetry lines (incl. tok_think) so reasoning overhead is visible per call.
Combine with an env override to A/B the reasoning knob without touching .env:
    OPENROUTER_REASONING_EFFORT= python scripts/verify_llm.py --bench 5      # provider default
    OPENROUTER_REASONING_EFFORT=none python scripts/verify_llm.py --bench 5  # thinking off

Exit code 0 if all calls succeed, 1 otherwise — usable as a deploy gate.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
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
    "openrouter": "OPENROUTER_API_KEY",
    "gemini": "GEMINI_API_KEY",
}


# Exercise-shaped workload for --bench: same schema/prompt style as _gen_multiple_choice, so the
# measured latency is the one a learner actually waits for on each card.
_BENCH_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "answer": {"type": "string"},
    },
    "required": ["text", "options", "answer"],
}
_BENCH_PROMPT = (
    "Create ONE short multiple-choice exercise focused on: prepositions of time (in/on/at).\n"
    "'text' is a sentence with a single blank shown as '___'. 'options' is 3-4 short choices. "
    "'answer' is exactly one of the options (the correct one). Reply ONLY as JSON matching the schema."
)


async def _bench(n: int) -> int:
    print(f"  bench: {n} exercise-shaped generate_json() calls")
    failures = 0
    for i in range(1, n + 1):
        started = time.monotonic()
        try:
            await llm.generate_json(_BENCH_PROMPT, _BENCH_SCHEMA, temperature=0.7)
            print(f"  {PASS} bench {i}/{n}: {int((time.monotonic() - started) * 1000)} ms")
        except Exception as exc:
            failures += 1
            print(f"  {FAIL} bench {i}/{n}: {type(exc).__name__}: {exc}")
    return failures


async def main(bench_n: int = 0) -> int:
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

    if bench_n:
        print()
        failures += await _bench(bench_n)

    print()
    if failures:
        print(f"\033[31m{failures} call(s) FAILED\033[0m — the LLM link is not working.\n")
        return 1
    print(f"\033[32mLLM link is live\033[0m — {provider}/{model} answered all calls.\n")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Live LLM-link check (+ optional latency bench).")
    parser.add_argument(
        "--bench", type=int, default=0, metavar="N",
        help="after the link check, run N exercise-shaped generate_json calls and print per-call latency",
    )
    args = parser.parse_args()
    if args.bench:
        # Surface the per-call `llm ok ... tok_think=` telemetry alongside the bench timings.
        logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
    sys.exit(asyncio.run(main(args.bench)))
