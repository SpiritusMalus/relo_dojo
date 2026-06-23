"""Scroll rewards — server-rolled variable reinforcement (monetization branch 4).

The "slot machine" of the dojo: after a finished session the client requests a scroll; the SERVER
rolls a weighted table and credits the prize, so the economy can't be farmed by a patched client.
The unpredictability is the point — most scrolls are small koku, the occasional fat drop or rare
charm is what makes the next session itch.

Abuse guard: SCROLLS_PER_DAY per account (UTC day), tracked in users.scroll_day / scrolls_used.
"""

from __future__ import annotations

import random
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User
# Single source of truth for the daily-reset calendar day (honors DAY_OFFSET_MIN).
from .gating import _utc_day


class _Rng(Protocol):
    def random(self) -> float: ...


# The prize roll feeds the economy (koku/charms), so use a CSPRNG, not the predictable global
# Mersenne Twister — a player must not be able to predict or await high-value drops. Tests inject
# their own deterministic `rng`. (Option/tile shuffles elsewhere stay on plain `random`: the answer
# is Fernet-sealed, so their order leaks nothing.)
_secure_rng = random.SystemRandom()


# (kind, amount, weight). Weights are relative; koku dominates, the rares carry the thrill.
SCROLL_TABLE: list[tuple[str, int, int]] = [
    ("koku", 5, 50),  # common: pocket change
    ("koku", 15, 30),  # decent
    ("koku", 40, 12),  # fat drop
    ("omamori", 1, 5),  # rare: streak charm
    ("kensei", 1, 3),  # rare: x2 XP boost (client-side timer)
]

_TOTAL_WEIGHT = sum(w for _, _, w in SCROLL_TABLE)


def roll_scroll(rng: _Rng = _secure_rng) -> tuple[str, int]:
    """Weighted roll over SCROLL_TABLE. `rng` injectable for deterministic tests."""
    pick = rng.random() * _TOTAL_WEIGHT
    acc = 0.0
    for kind, amount, weight in SCROLL_TABLE:
        acc += weight
        if pick < acc:
            return kind, amount
    return SCROLL_TABLE[-1][0], SCROLL_TABLE[-1][1]  # float edge — give the last row


async def grant_scroll(user: User, db: AsyncSession, rng: _Rng = _secure_rng) -> dict:
    """Roll and credit one scroll for the user; 403 {code: scroll_limit} past the daily cap."""
    # Row-lock the account: the daily cap is the farm guard, so two concurrent /rewards/scroll
    # calls must not both pass the cap check and both credit koku. Released by the commit below.
    await db.refresh(user, with_for_update=True)
    today = _utc_day()
    if user.scroll_day != today:
        user.scroll_day = today
        user.scrolls_used = 0
    # Black Belt perk: double the daily scroll cap.
    cap = settings.SCROLLS_PER_DAY * (2 if getattr(user, "is_premium", False) else 1)
    if user.scrolls_used >= cap:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "scroll_limit", "message": "No more scrolls today — the dojo rests."},
        )
    kind, amount = roll_scroll(rng)
    # Black Belt perk: koku prizes are doubled too (user decision 2026-06-11 — cap alone was a
    # weaker perk than x2 koku and didn't justify the upsell). Rares (omamori/kensei) stay 1:
    # doubling a charm or a timed boost would distort their value, not their thrill.
    if kind == "koku" and getattr(user, "is_premium", False):
        amount *= 2
    user.scrolls_used += 1
    if kind == "koku":
        user.coins += amount
    elif kind == "omamori":
        user.freezes += amount
    # "kensei" is a client-side XP timer — nothing to credit server-side.
    await db.commit()
    await db.refresh(user)
    return {
        "kind": kind,
        "amount": amount,
        "coins": user.coins,
        "freezes": user.freezes,
    }
