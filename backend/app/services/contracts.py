"""Daily contracts (engagement v2, Phase 2) — daily-return + varied earning.

Each UTC day the learner gets a small, deterministic set of micro-goals ("contracts from Sensei")
that pay koku. Two design rules from the plan:
- **Varied earning**: contracts reward DIFFERENT activities (answer some, finish a session, get N
  correct), so the loop isn't "spam one mode". They give a reason to come back daily.
- **Server-verified payout**: koku is server-authoritative, so completion is checked against the
  EVENTS table (the funnel pipeline) — never trusted from the client. A contract pays once per day.

The pure layer here (template pool, deterministic daily pick, progress/claimable math) unit-tests
without a DB. The event counts + the claim write live in the router (thin DB layer).
"""

from __future__ import annotations

import hashlib
from typing import Any

# Contract templates. `metric` is the key looked up in the day's event-count bag (see router):
#   answered          = # of exercise_answered events today
#   answered_correct  = # of those with props.correct == true
#   sessions          = # of session_complete events today
#   reviews           = # of review_submitted events today
TEMPLATES: list[dict[str, Any]] = [
    {"id": "warmup", "metric": "answered", "target": 5, "reward": 15},
    {"id": "marathon", "metric": "answered", "target": 20, "reward": 40},
    {"id": "sharp", "metric": "answered_correct", "target": 8, "reward": 25},
    {"id": "finisher", "metric": "sessions", "target": 1, "reward": 10},
    {"id": "double", "metric": "sessions", "target": 2, "reward": 30},
    {"id": "reviewer", "metric": "reviews", "target": 1, "reward": 20},
]

DAILY_COUNT = 3  # contracts offered per day

_BY_ID = {tpl["id"]: tpl for tpl in TEMPLATES}


def daily_contract_ids(subject: str, day: str, k: int = DAILY_COUNT) -> list[str]:
    """Deterministic per (subject, day) selection of contract ids — stable within a day, varies by
    day/user. Pure: a hash seed orders the pool, we take the first k (order normalized to TEMPLATES)."""
    ranked = sorted(
        TEMPLATES,
        key=lambda tpl: hashlib.sha256(f"{subject}:{day}:{tpl['id']}".encode()).hexdigest(),
    )
    picked = {tpl["id"] for tpl in ranked[:k]}
    # Return in canonical TEMPLATES order so the UI list is stable regardless of hash order.
    return [tpl["id"] for tpl in TEMPLATES if tpl["id"] in picked]


def build_today(subject: str, day: str, counts: dict[str, int], claimed: set[str]) -> list[dict]:
    """Today's contracts with progress, done, claimed and reward — for GET /contracts."""
    out: list[dict] = []
    for cid in daily_contract_ids(subject, day):
        tpl = _BY_ID[cid]
        progress = min(counts.get(tpl["metric"], 0), tpl["target"])
        out.append(
            {
                "id": cid,
                "metric": tpl["metric"],
                "target": tpl["target"],
                "reward": tpl["reward"],
                "progress": progress,
                "done": progress >= tpl["target"],
                "claimed": cid in claimed,
            }
        )
    return out


def is_claimable(subject: str, day: str, contract_id: str, counts: dict[str, int], claimed: set[str]) -> bool:
    """True only if the contract is one of today's, met its target, and isn't already claimed."""
    if contract_id not in daily_contract_ids(subject, day):
        return False
    if contract_id in claimed:
        return False
    tpl = _BY_ID.get(contract_id)
    if tpl is None:
        return False
    return counts.get(tpl["metric"], 0) >= tpl["target"]


def reward_for(contract_id: str) -> int:
    tpl = _BY_ID.get(contract_id)
    return tpl["reward"] if tpl else 0
