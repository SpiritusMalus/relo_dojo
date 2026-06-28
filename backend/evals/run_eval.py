"""Eval runner — objective model/prompt comparison for the checking path.

Feeds every {exercise, answer} from eval_set.json through the SAME `check_answer()` the app uses
(same prompt, schema, temperature) and compares the model's verdict with the hand-vetted expected
one. Use it to compare models (gemma3:4b vs 12b, a Modelfile build, ...) or to regression-test any
prompt change in grammar.py before it hits users.

Usage (from backend/, venv active; Ollama running for the ollama provider):
    python -m evals.run_eval                       # provider+model from .env
    python -m evals.run_eval --model gemma3:12b    # override the active provider's model
    python -m evals.run_eval --provider anthropic  # eval the API path (needs ANTHROPIC_API_KEY)
    python -m evals.run_eval --provider openai --model gpt-4o-mini
    python -m evals.run_eval --provider openrouter  # Gemini via OpenRouter (needs OPENROUTER_API_KEY)
    python -m evals.run_eval --provider gemini  # Flash-Lite path (needs GEMINI_API_KEY)
    python -m evals.run_eval --limit 10            # quick smoke run
    python -m evals.run_eval --generate 5          # also: generation smoke test, 5 items/type

A JSON report is written to evals/reports/ so runs can be diffed later.
Exit code 1 if accuracy < --min-accuracy (default 0.9) — usable in CI.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent


# Which env var the --model override lands in, per provider.
_MODEL_ENV = {
    "ollama": "OLLAMA_MODEL",
    "anthropic": "ANTHROPIC_MODEL",
    "openai": "OPENAI_MODEL",
    "openrouter": "OPENROUTER_MODEL",
    "gemini": "GEMINI_MODEL",
}


def _bootstrap(model: str | None, provider: str | None) -> None:
    """Set env BEFORE importing app modules (config reads env at import time).
    The eval never touches the DB, so required-but-unused secrets get dummies."""
    if provider:
        os.environ["LLM_PROVIDER"] = provider
    active = (provider or os.environ.get("LLM_PROVIDER") or "ollama").lower()
    if model:
        os.environ[_MODEL_ENV.get(active, "OLLAMA_MODEL")] = model
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://eval:eval@localhost/eval_unused")
    os.environ.setdefault("JWT_SECRET", "eval-unused")
    sys.path.insert(0, str(BACKEND))


async def run_checks(items: list[dict], min_accuracy: float) -> dict:
    from app.services.grammar import check_answer  # imported after _bootstrap

    results: list[dict] = []
    correct = 0
    for i, item in enumerate(items, 1):
        try:
            verdict = await check_answer(item["text"], item["answer"])
            got = bool(verdict["correct"])
            ok = got == item["expected"]
        except Exception as exc:  # noqa: BLE001 — a model failure is itself a result
            got, ok, verdict = None, False, {"error": str(exc)}
        correct += ok
        status = "ok" if ok else "MISMATCH"
        print(f"[{i:>2}/{len(items)}] {item['id']:<8} expected={item['expected']!s:<5} got={got!s:<5} {status}")
        results.append({**item, "got": got, "ok": ok, "model_output": verdict})

    accuracy = correct / len(items) if items else 0.0
    by_topic: dict[str, list[bool]] = {}
    for r in results:
        by_topic.setdefault(r["topic"], []).append(r["ok"])
    print(f"\nAccuracy: {correct}/{len(items)} = {accuracy:.1%}  (threshold {min_accuracy:.0%})")
    for topic, oks in sorted(by_topic.items()):
        print(f"  {topic:<35} {sum(oks)}/{len(oks)}")
    mismatches = [r for r in results if not r["ok"]]
    if mismatches:
        print("\nMismatches:")
        for r in mismatches:
            print(f"  {r['id']}: \"{r['text']}\" + {r['answer']!r} → expected {r['expected']}, got {r['got']} ({r['note']})")
    return {"accuracy": accuracy, "results": results}


async def run_generation_smoke(per_type: int) -> dict:
    """Generate items per type through the real pipeline; count validation failures (503s).
    A high failure rate = the model can't reliably fill that type's schema."""
    from app.services.grammar import _ENABLED_TYPES, generate_exercise
    from app.services.llm import LLMError as OllamaError

    stats: dict[str, dict] = {}
    for ex_type in sorted(_ENABLED_TYPES):
        ok = fail = 0
        for _ in range(per_type):
            try:
                await generate_exercise(ex_type=ex_type, level="B1")
                ok += 1
            except OllamaError:
                fail += 1
        stats[ex_type] = {"ok": ok, "fail": fail}
        print(f"  {ex_type:<20} {ok}/{ok + fail} usable")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", help="override the active provider's model for this run")
    ap.add_argument(
        "--provider",
        choices=["ollama", "anthropic", "openai", "openrouter", "gemini"],
        help="override LLM_PROVIDER",
    )
    ap.add_argument("--file", default=str(HERE / "eval_set.json"), help="eval set path")
    ap.add_argument("--limit", type=int, help="only run the first N items")
    ap.add_argument("--generate", type=int, metavar="N", help="also run a generation smoke test, N items per type")
    ap.add_argument("--min-accuracy", type=float, default=0.9, help="exit 1 below this (default 0.9)")
    args = ap.parse_args()

    _bootstrap(args.model, args.provider)
    from app.core.config import settings  # after bootstrap
    from app.services.llm import active_model  # after bootstrap

    items = json.loads(Path(args.file).read_text())["items"]
    if args.limit:
        items = items[: args.limit]
    provider = settings.LLM_PROVIDER
    where = settings.OLLAMA_URL if provider == "ollama" else "API"
    print(f"Provider: {provider} | Model: {active_model()} @ {where}")
    print(f"Items: {len(items)}\n")

    report = asyncio.run(run_checks(items, args.min_accuracy))
    if args.generate:
        print("\nGeneration smoke test:")
        report["generation"] = asyncio.run(run_generation_smoke(args.generate))

    reports = HERE / "reports"
    reports.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    model_slug = active_model().replace(":", "_").replace("/", "_")
    out = reports / f"{model_slug}_{stamp}.json"
    out.write_text(
        json.dumps(
            {"provider": provider, "model": active_model(), "when": stamp, **report},
            indent=2,
            ensure_ascii=False,
        )
    )
    print(f"\nReport: {out.relative_to(BACKEND)}")

    sys.exit(0 if report["accuracy"] >= args.min_accuracy else 1)


if __name__ == "__main__":
    main()
