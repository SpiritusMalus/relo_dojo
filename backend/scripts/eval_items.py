#!/usr/bin/env python3
"""Defect-rate harness — how often does generation ship something unusable?

Until now the only detector of a bad exercise was the owner hitting one during dogfood and sending a
screenshot. That measures nothing: after a prompt change you cannot tell "fixed" from "got lucky".
This script generates real items through the real `generate_exercise` path and reports, per topic ×
type, how many attempts the validators threw away and how many cards died outright.

What the number means:
  - `reject %` — attempts the validators refused (a bad item that never reached a learner). High is
    not automatically bad: on model-authored types it is the guard doing its job, and it is exactly
    the figure a prompt change should move.
  - `fail %`   — cards that could not be produced at all after the retry+fallback ladder. Any
    non-zero value here is a learner seeing a 503.
  - key-first topics (prepositions, articles — see _item_blueprints) cannot ship a wrong ANSWER by
    construction, so their rejects are only "the model missed the frame", never "the key is wrong".

Usage (from backend/, with .env holding LLM_PROVIDER + the provider's API key):
    python scripts/eval_items.py                     # 5 items per topic × type, default mix
    python scripts/eval_items.py -n 20 --topic prepositions --topic articles
    python scripts/eval_items.py -n 10 --type multiple-choice --level B1

Exit code 0 when every cell produced at least one card, 1 otherwise — usable as a release gate.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import _grammar_generators as gen  # noqa: E402
from app.services import _item_blueprints as blueprints  # noqa: E402
from app.services.llm import LLMError  # noqa: E402

DEFAULT_TOPICS = ("prepositions", "articles", "conditionals", "word order")
DEFAULT_TYPES = ("multiple-choice", "tap-the-error", "multiple-blanks")


class _RejectCounter(logging.Handler):
    """The generators announce every refusal through `logger.info("generation rejected: %s")`.
    Tapping that log is how we count rejects without threading a return channel through the whole
    generation path just for this script."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.reasons: Counter[str] = Counter()
        self.total = 0

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if msg.startswith("generation rejected:"):
            self.total += 1
            # Group by the defect, not the sentence: "tap-the-error: correction must ..." is a class.
            self.reasons[msg.split(":", 2)[-1].strip()[:70]] += 1


async def _run_cell(topic: str, ex_type: str, level: str, n: int) -> dict:
    tap = _RejectCounter()
    logger = logging.getLogger("app.services._grammar_generators")
    logger.addHandler(tap)
    logger.setLevel(logging.INFO)
    made = failed = 0
    served_type: Counter[str] = Counter()
    try:
        for _ in range(n):
            try:
                item = await gen.generate_exercise(topic=topic, ex_type=ex_type, level=level)
            except LLMError as exc:
                failed += 1
                tap.reasons[f"LLM error: {type(exc).__name__}"] += 1
                continue
            made += 1
            served_type[item["type"]] += 1
    finally:
        logger.removeHandler(tap)
    attempts = tap.total + made
    return {
        "topic": topic,
        "type": ex_type,
        "made": made,
        "failed": failed,
        "rejects": tap.total,
        "reject_pct": (100.0 * tap.total / attempts) if attempts else 0.0,
        "fail_pct": 100.0 * failed / n,
        "served": served_type,
        "reasons": tap.reasons,
    }


def _print_report(rows: list[dict], level: str) -> None:
    print(f"\n=== item defect rate (level {level}) ===\n")
    print(f"{'topic':<16} {'type':<18} {'made':>5} {'fail%':>7} {'reject%':>8}  served as")
    print("-" * 86)
    for r in rows:
        served = ", ".join(f"{k}×{v}" for k, v in r["served"].most_common()) or "—"
        mark = " *" if r["topic"] in blueprints.BLUEPRINT_TOPICS else "  "
        print(
            f"{r['topic']:<14}{mark} {r['type']:<18} {r['made']:>5} "
            f"{r['fail_pct']:>6.0f}% {r['reject_pct']:>7.0f}%  {served}"
        )
    print("\n* key-first topic: the answer is computed by our rule, so a reject means the model")
    print("  missed the pinned frame — it can never mean the shipped key was wrong.\n")

    reasons: Counter[str] = Counter()
    for r in rows:
        reasons.update(r["reasons"])
    if reasons:
        print("top rejection reasons:")
        for reason, count in reasons.most_common(10):
            print(f"  {count:>4}  {reason}")
        print()


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", type=int, default=5, help="items per topic × type cell (default 5)")
    ap.add_argument("--topic", action="append", help="repeatable; default: a representative mix")
    ap.add_argument("--type", action="append", dest="types", help="repeatable; default: the risky types")
    ap.add_argument("--level", default="B1")
    args = ap.parse_args()

    topics = args.topic or list(DEFAULT_TOPICS)
    types = args.types or list(DEFAULT_TYPES)
    total = len(topics) * len(types) * args.n
    print(f"generating {total} items ({len(topics)} topics × {len(types)} types × {args.n})…")

    rows = []
    for topic in topics:
        for ex_type in types:
            row = await _run_cell(topic, ex_type, args.level, args.n)
            rows.append(row)
            print(f"  {topic}/{ex_type}: {row['made']}/{args.n} made, {row['rejects']} rejected")

    _print_report(rows, args.level)
    empty = [f"{r['topic']}/{r['type']}" for r in rows if r["made"] == 0]
    if empty:
        print(f"FAIL — no card at all for: {', '.join(empty)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
