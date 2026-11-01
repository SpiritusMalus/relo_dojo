"""Four synthetic explanation checks after the native odd-one-out finding. Never imports main.

Requires explicit funded authorization. The process reads only the server-side OpenRouter key;
it never copies credentials, starts services, connects to the DB or alters the running QA tree.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import time
import urllib.request


BASE_MODEL = "google/gemini-3.5-flash-lite"
SMART_MODEL = "openai/gpt-6.1-terra"
SOURCE_FILES = ["app/core/config.py", "app/services/_grammar_feedback.py",
                "app/services/_grammar_generators.py", "app/services/_grammar_prompts.py",
                "app/services/_grammar_rules.py", "app/services/llm.py", "evals/check_explanations.py"]
ODD = (
    "Exercise type: odd-one-out\nTopic: word order\n"
    "Instruction: Tap the one that doesn't belong.\nVisible options:\n"
    "- Always we deploy\n- Seldom do we\n- Rarely can they\n- Little did anyone"
)
MC = (
    "Exercise type: multiple-choice\nTopic: verb sequence (tense agreement)\n"
    "Instruction: Choose the word that completes the sentence.\n"
    "Sentence: She ___ here every day.\nVisible options:\n- works\n- work\n- working"
)


async def run(args, hashes):
    from app.services import _grammar_feedback as feedback, http_client, llm
    from app.core.config import settings

    selected = args.model
    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as response:
        entry = next(item for item in json.load(response)["data"] if item["id"] == selected)
    eligible_request = urllib.request.Request("https://openrouter.ai/api/v1/models/user", headers={
        "Authorization": "Bearer " + settings.OPENROUTER_API_KEY})
    with urllib.request.urlopen(eligible_request, timeout=30) as response:
        if selected not in {item["id"] for item in json.load(response)["data"]}:
            raise SystemExit("Selected model is not eligible; no billable call was made")
    original_post = llm._post
    accounted, events = 0.0, []

    async def measured_post(url, headers, payload, name, model=""):
        nonlocal accounted
        if payload.get("model", model) != selected:
            raise llm.LLMError("Targeted explanation check is limited to the selected model")
        price = entry["pricing"]
        bound = (len(json.dumps(payload, ensure_ascii=False).encode()) * float(price["prompt"]) +
                 payload.get("max_tokens", 1024) * float(price["completion"])) * (llm.LLM_RETRIES + 1)
        if accounted + bound > args.budget_usd:
            raise llm.LLMError("Targeted explanation budget exhausted before request")
        event = {"model": selected, "conservative_reservation_usd": bound}
        events.append(event)
        try:
            result = await original_post(url, headers, payload, name, model)
            usage = result.get("usage") or {}
            event.update(cost_usd=usage.get("cost"), prompt_tokens=usage.get("prompt_tokens"),
                         completion_tokens=usage.get("completion_tokens"))
            return result
        except Exception as exc:
            event["error"] = type(exc).__name__
            raise
        finally:
            accounted += float(event["cost_usd"]) if event.get("cost_usd") is not None else bound

    llm._post = measured_post
    rows = []
    try:
        for kind, text, key, answer in [("odd-classification", ODD, "Always we deploy", "Rarely can they"),
                                       ("ordinary-mc", MC, "works", "work")]:
            if args.odd_only and kind != "odd-classification":
                continue
            for lang in ["ru", "en"]:
                started = time.monotonic()
                before = len(events)
                row = {"case": kind, "lang": lang, "text": text, "key": key, "response": answer}
                try:
                    row["output"] = await feedback.explain(text, key, answer, lang=lang)
                    row["status"] = "returned"
                except Exception as exc:
                    row.update(status="failed", error=type(exc).__name__)
                row.update(ms=round((time.monotonic() - started) * 1000), calls=events[before:])
                rows.append(row)
                print(json.dumps({k: row[k] for k in ["case", "lang", "status", "ms"]}), flush=True)
    finally:
        await http_client.aclose()
    report = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": "native-odd-explanation-regression-v1", "model": selected,
        "scope": f"{len(rows)} structured Explain calls on synthetic full visible context; no new generation matrix or live API restart",
        "source_sha256": hashes, "budget_cap_usd": args.budget_usd,
        "reported_cost_usd": sum(event.get("cost_usd") or 0 for event in events),
        "conservative_accounted_usd": accounted,
        "manual_review_criteria": {
            "odd-classification": "Distinguish affirmative normal order from negative-fronting inversion; do not call the inverted alternatives bad English or claim the subject is the first word in Always we deploy.",
            "ordinary-mc": "Explain present-simple third-person singular works in the requested language without weakening correctness.",
        },
        "manual_review_status": "pending inspection of actual outputs",
        "results": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"reported_cost_usd": report["reported_cost_usd"], "output": str(args.output)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--expected-hashes", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--budget-usd", type=float, default=.05)
    parser.add_argument("--model", choices=[BASE_MODEL, SMART_MODEL], default=SMART_MODEL)
    parser.add_argument("--odd-only", action="store_true", help="rerun only the observed classification in RU/EN")
    args = parser.parse_args()
    if not 0 < args.budget_usd <= .05:
        parser.error("budget must be positive and at most $0.05")
    backend = Path(__file__).resolve().parent.parent
    hashes = {name: hashlib.sha256((backend / name).read_bytes()).hexdigest() for name in SOURCE_FILES}
    if json.loads(args.expected_hashes.read_text()) != hashes:
        raise SystemExit("Source hashes differ; no provider call was made")
    from dotenv import dotenv_values
    key = dotenv_values(args.env_file).get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OpenRouter key absent; no provider call was made")
    os.environ.update(OPENROUTER_API_KEY=key, ENV="dev", LLM_PROVIDER="openrouter", AUTO_MIGRATE="false",
                      DATABASE_URL="postgresql+asyncpg://unused:unused@localhost/unused",
                      JWT_SECRET="synthetic-eval-only", OPENROUTER_MODEL=BASE_MODEL,
                      OPENROUTER_MODEL_SMART=args.model,
                      OPENROUTER_REASONING_EFFORT="low", OPENROUTER_PROVIDER_SORT="latency")
    from cryptography.fernet import Fernet
    os.environ["CHECK_SECRET"] = Fernet.generate_key().decode()
    logging.disable(logging.CRITICAL)
    asyncio.run(run(args, hashes))


if __name__ == "__main__":
    main()
