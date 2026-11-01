"""Bounded, synthetic end-to-end generation comparison. Never imports main or touches the DB.

Run on the approved server without moving credentials:
  .venv/bin/python -m evals.compare_openrouter --env-file /opt/relo_dojo/backend/.env \
      --output /protected/path/comparison.json

Exercises use the production generator, structural rules, semantic-review retry ladder and token
grading. The fixed reviewer is deliberately separate from the compared generator models. Its
judgments are fallible; inspect the saved questions/keys/rejections before choosing a default.
Costs are reported from OpenRouter usage; conservative byte-token reservations bound spend.
"""
from __future__ import annotations

import argparse
import asyncio
from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import math
import hashlib
import os
from pathlib import Path
import statistics
import time
import urllib.request


MODELS = ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite",
          "openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]
CASES = [
    ("A1", "articles", "multiple-choice"),
    ("A1", "vocabulary", "match-pairs"),
    ("A1", "verb sequence (tense agreement)", "build-the-sentence"),
    ("A2", "prepositions", "tap-the-error"),
    ("A2", "verb sequence (tense agreement)", "multiple-blanks"),
    ("A2", "vocabulary", "listen-and-answer"),
    ("B1", "conditionals", "multiple-choice"),
    ("B1", "word order", "build-the-sentence"),
    ("B1", "phrasal verbs", "odd-one-out"),
    ("B2", "conditionals", "transform-the-sentence"),
    ("B2", "verb sequence (tense agreement)", "order-the-dialog"),
    ("B2", "vocabulary", "match-pairs"),
    ("C1", "conditionals", "multiple-choice"),
    ("C1", "verb sequence (tense agreement)", "multiple-blanks"),
    ("C1", "vocabulary", "listen-and-answer"),
    ("B2", "prepositions", "multiple-choice"),
    ("C1", "articles", "multiple-choice"),
]

# Sealed after model/prompt selection: new topic/format/context combinations, not retuned on their
# results. These cover a request-only retell as well as weighted exercise formats.
HOLDOUT_CASES = [
    ("A1", "articles", "multiple-choice", "breakfast in a shared flat"),
    ("A1", "word order", "build-the-sentence", "buying fruit at a street market"),
    ("A1", "vocabulary", "match-pairs", "borrowing pens in a classroom"),
    ("A1", "prepositions", "tap-the-error", "a first visit to a library"),
    ("A2", "modal verbs", "multiple-choice", "rules at a public swimming pool"),
    ("A2", "gerunds & infinitives", "multiple-blanks", "weekend housework"),
    ("A2", "vocabulary", "listen-and-answer", "sorting household recycling"),
    ("A2", "verb sequence (tense agreement)", "order-the-dialog", "a lost ticket to an event"),
    ("B1", "phrasal verbs", "multiple-choice", "making a new phone work"),
    ("B1", "comparatives & superlatives", "build-the-sentence", "choosing between two flats"),
    ("B1", "punctuation", "tap-the-error", "notes about a train delay"),
    ("B1", "vocabulary", "odd-one-out", "repairing a bicycle"),
    ("B2", "conditionals", "transform-the-sentence", "a missed flight after a delayed bus"),
    ("B2", "prepositions", "match-pairs", "discussing workplace responsibilities"),
    ("B2", "articles", "multiple-choice", "explaining customs at a small museum"),
    ("B2", "verb sequence (tense agreement)", "listen-and-retell", "a late parcel and corrected tracking"),
    ("C1", "modal verbs", "multiple-choice", "auditing an overnight server outage"),
    ("C1", "gerunds & infinitives", "transform-the-sentence", "regretting an unread email"),
    ("C1", "vocabulary", "listen-and-answer", "a tenant reacting to optimistic renovation promises"),
    ("C1", "word order", "order-the-dialog", "negotiating a shared office plan"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", nargs="+", default=MODELS)
    parser.add_argument("--review-model", default="openai/gpt-6.1-terra")
    parser.add_argument("--budget-usd", type=float, default=3.0)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--case-limit", type=int)
    parser.add_argument("--case-indices", type=int, nargs="+")
    parser.add_argument("--holdout", action="store_true", help="use the sealed 20-case varied-context holdout")
    args = parser.parse_args()
    if not 0 < args.budget_usd <= 3 or not 1 <= args.concurrency <= 4:
        parser.error("budget must be >0 and <=$3; concurrency must be 1..4")
    if args.env_file:
        from dotenv import dotenv_values
        key = dotenv_values(args.env_file).get("OPENROUTER_API_KEY")
        if key:
            os.environ["OPENROUTER_API_KEY"] = key
    if not os.environ.get("OPENROUTER_API_KEY"):
        parser.error("OPENROUTER_API_KEY is absent; no provider call was made")
    # Isolate from dev billing, production DB and startup migrations. These settings only support
    # service-module imports. There is no engine connection, registration, user or customer data.
    os.environ.update(ENV="dev", LLM_PROVIDER="openrouter", AUTO_MIGRATE="false",
                      DATABASE_URL="postgresql+asyncpg://unused:unused@localhost/unused",
                      JWT_SECRET="synthetic-eval-only", EXERCISE_REVIEW_ENABLED="true",
                      OPENROUTER_REASONING_EFFORT="low", OPENROUTER_PROVIDER_SORT="latency")
    from cryptography.fernet import Fernet
    os.environ["CHECK_SECRET"] = Fernet.generate_key().decode()
    logging.disable(logging.CRITICAL)
    asyncio.run(run(args))


async def run(args) -> None:
    from app.services import _grammar_generators as gen, llm, tokens, http_client
    from app.core.config import settings
    from app.services._grammar_grading import grade

    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as response:
        catalogue = {item["id"]: item for item in json.load(response)["data"]}
    for slug in [*args.models, args.review_model]:
        if slug not in catalogue or "structured_outputs" not in catalogue[slug]["supported_parameters"]:
            raise SystemExit(f"Unavailable structured-output model: {slug}")
    request = urllib.request.Request("https://openrouter.ai/api/v1/models/user", headers={
        "Authorization": "Bearer " + settings.OPENROUTER_API_KEY})
    with urllib.request.urlopen(request, timeout=30) as response:
        eligible = {item["id"] for item in json.load(response)["data"]}
    current_model = ContextVar("eval_model")
    current_trace = ContextVar("eval_trace")
    stage = ContextVar("eval_stage", default="generation")
    original_post, original_generate = llm._post, gen.generate_json
    semaphore, budget_lock = asyncio.Semaphore(args.concurrency), asyncio.Lock()
    reserved = 0.0
    accounted = 0.0

    async def measured_post(url, headers, payload, name, model=""):
        nonlocal reserved, accounted
        slug = payload.get("model", model)
        price = catalogue[slug]["pricing"]
        # UTF-8 bytes are a conservative upper bound on input tokens. Reserve every possible
        # transport retry too, rather than discovering overspend after an in-flight call.
        bound = (len(json.dumps(payload, ensure_ascii=False).encode()) * float(price["prompt"]) +
                 payload.get("max_tokens", 1024) * float(price["completion"])) * (llm.LLM_RETRIES + 1)
        async with budget_lock:
            if accounted + reserved + bound > args.budget_usd:
                raise llm.LLMError("Synthetic evaluation budget exhausted before request")
            reserved += bound
        started = time.monotonic()
        event = {"stage": stage.get(), "model": slug}
        current_trace.get().append(event)
        try:
            result = await original_post(url, headers, payload, name, model)
            usage = result.get("usage") or {}
            event.update(ms=round((time.monotonic() - started) * 1000),
                         prompt_tokens=usage.get("prompt_tokens"),
                         completion_tokens=usage.get("completion_tokens"),
                         cost_usd=usage.get("cost"), provider=result.get("provider"))
            return result
        except Exception as exc:
            event.update(ms=round((time.monotonic() - started) * 1000), error=type(exc).__name__)
            raise
        finally:
            async with budget_lock:
                reserved -= bound
                # Missing cost (including a rejected request) retains the conservative bound.
                # Known billed cost frees unused reservation for the next request.
                accounted += float(event["cost_usd"]) if event.get("cost_usd") is not None else bound

    async def measured_generate(prompt, schema, *, temperature=None, tier="fast"):
        marker = stage.set("review" if tier == "smart" else "repair_generation" if tier == "repair" else "generation")
        try:
            value = await original_generate(prompt, schema, temperature=temperature, tier=tier)
            # Save synthetic inputs/outputs, not prompts, headers, tokens, identities or reasoning.
            current_trace.get()[-1]["output"] = value
            return value
        finally:
            stage.reset(marker)

    llm._post = measured_post
    llm._model_for = lambda provider, tier="fast": (args.review_model if tier == "smart" else
        settings.OPENROUTER_MODEL_REPAIR if tier == "repair" else current_model.get())
    gen.generate_json = measured_generate

    async def one(model, index, case):
        async with semaphore:
            level, topic, requested = case[:3]
            context = case[3] if len(case) == 4 else "everyday life"
            current_model.set(model)
            trace = []
            current_trace.set(trace)
            row = {"model": model, "case": index, "level": level, "topic": topic,
                   "requested_type": requested, "context": context, "practice_index": index, "calls": trace}
            if model not in eligible or args.review_model not in eligible:
                row.update(served=False, ms=0, status="access_blocked",
                           detail="Generator or reviewer excluded by authenticated model eligibility; no billable call made")
                return row
            started = time.monotonic()
            try:
                item = await gen.generate_exercise(topic=topic, level=level, ex_type=requested,
                                                   context=context, lang="ru", practice_index=index)
                key = tokens.unseal(item["token"]) if item.get("token") else {}
                row.update(served=True, status="served", actual_type=item["type"], actual_level=item.get("level"),
                           task={k: v for k, v in item.items() if k != "token"}, key=key)
                # Exercise the deterministic checker with the keyed response where representable.
                kind = key.get("t")
                response = (key.get("sentence") if kind in {"build-the-sentence", "transform-the-sentence"}
                            else key.get("index") if kind == "tap-the-error"
                            else key.get("map") if kind == "match-pairs"
                            else key.get("order") if kind == "order-the-dialog"
                            else key.get("answers") if kind == "multiple-blanks"
                            else key.get("answer"))
                if response is not None:
                    row["key_grades_correct"] = grade(key, response).get("correct")
            except Exception as exc:
                blocked = "guardrail restrictions" in str(exc) or "Model blocked" in str(exc)
                row.update(served=False, status="access_blocked" if blocked else "generation_failed",
                           error=type(exc).__name__, detail=str(exc)[:300])
            row["ms"] = round((time.monotonic() - started) * 1000)
            print(json.dumps({k: row.get(k) for k in ["model", "case", "served", "actual_type", "ms", "error"]}), flush=True)
            return row

    cases = HOLDOUT_CASES if args.holdout else CASES
    count = args.case_limit if args.case_limit is not None else len(cases)
    indices = args.case_indices if args.case_indices is not None else list(range(min(count, len(cases))))
    if not indices or any(index < 0 or index >= len(cases) for index in indices):
        raise SystemExit("case indices must select at least one existing synthetic case")
    rows = await asyncio.gather(*(one(model, i, cases[i]) for model in args.models for i in indices))
    await http_client.aclose()
    summary = []
    for model in args.models:
        own = [row for row in rows if row["model"] == model]
        calls = [call for row in own for call in row["calls"]]
        elapsed = sorted(row["ms"] for row in own)
        reviews = [call for call in calls if call["stage"] == "review" and "output" in call]
        cost_known = [call["cost_usd"] for call in calls if call.get("cost_usd") is not None]
        summary.append({"model": model, "cases": len(own),
                        "served": sum(row["served"] for row in own),
                        "generated_served": sum(row.get("task", {}).get("source", "generated") == "generated" and row["served"] for row in own),
                        "curated_served": sum(row.get("task", {}).get("source") == "curated" and row["served"] for row in own),
                        "access_blocked_cases": sum(row.get("status") == "access_blocked" for row in own),
                        "requested_format_served": sum(row.get("actual_type") == row["requested_type"] for row in own),
                        "semantic_rejections": sum(call["output"].get("valid") is False for call in reviews),
                        "provider_calls": len(calls), "median_ms": statistics.median(elapsed),
                        "repair_calls": sum(call["stage"] == "repair_generation" for call in calls),
                        "p95_ms": elapsed[max(0, math.ceil(len(elapsed) * .95) - 1)],
                        "reported_cost_usd": sum(cost_known),
                        "calls_with_reported_cost": len(cost_known)})
    backend = Path(__file__).resolve().parent.parent
    source_files = [backend / "app/core/config.py", *(backend / "app/services").glob("_grammar*.py"),
                    *(backend / "app/services" / name for name in ["llm.py", "curated_fallback.py", "_item_blueprints.py", "tokens.py"])]
    source_hashes = {str(path.relative_to(backend)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in sorted(source_files)}
    report = {"schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
              "dataset": "holdout-20-v1" if args.holdout else "development-matrix-v1",
              "source_sha256": source_hashes,
              "scope": "synthetic generation, structural validation, conditional independent semantic review, retries and grading; no customer data",
              "review_model": args.review_model, "budget_cap_usd": args.budget_usd,
              "repair_model": settings.OPENROUTER_MODEL_REPAIR if settings.EXERCISE_REPAIR_ENABLED else None,
              "conservative_accounted_usd": accounted + reserved,
              "authenticated_eligible_models": sorted(eligible),
              "same_model_review": args.review_model in args.models,
              "sources": ["https://openrouter.ai/api/v1/models", "https://openrouter.ai/docs/guides/features/structured-outputs"],
              "catalogue": {slug: {k: catalogue[slug][k] for k in ["id", "pricing", "supported_parameters"]}
                            for slug in dict.fromkeys([*args.models, args.review_model,
                                *([settings.OPENROUTER_MODEL_REPAIR] if settings.EXERCISE_REPAIR_ENABLED else [])])},
              "summary": summary, "results": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"summary": summary, "output": str(args.output)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
