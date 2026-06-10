"""Koku wallet — server-authoritative economy (monetization plan, branch 1).

Earning and spending both happen here so the client can never set a balance:
- `award_correct_check` credits koku for a correct /check answer (authenticated callers only).
- `spend` debits coins / consumes items atomically (guarded UPDATE — no read-modify-write race).

Catalog items:
- "omamori"     buy a streak-freeze charm: coins -= PRICE_OMAMORI * qty, freezes += qty
- "use_freeze"  consume an owned charm (streak logic, branch 3): freezes -= qty, no coin cost
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User

_UNKNOWN_ITEM = "Unknown shop item."
_NOT_ENOUGH = "Not enough koku."
_NO_FREEZES = "No omamori left."


async def award_correct_check(user: User | None, db: AsyncSession) -> tuple[int, int | None]:
    """Credit koku for one correct interactive answer.

    Returns (earned, new_balance); (0, None) for anonymous callers."""
    if user is None:
        return 0, None
    earned = settings.COIN_REWARD_CORRECT
    res = await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(coins=User.coins + earned)
        .returning(User.coins)
    )
    balance = res.scalar_one()
    await db.commit()
    return earned, balance


async def spend(user: User, db: AsyncSession, item: str, qty: int) -> User:
    """Apply one catalog purchase/consumption atomically; refresh and return the user.

    409 when the balance (coins or freezes) is insufficient; 400 for an unknown item."""
    if item == "omamori":
        cost = settings.PRICE_OMAMORI * qty
        stmt = (
            update(User)
            .where(User.id == user.id, User.coins >= cost)
            .values(coins=User.coins - cost, freezes=User.freezes + qty)
        )
        short = _NOT_ENOUGH
    elif item == "use_freeze":
        stmt = (
            update(User)
            .where(User.id == user.id, User.freezes >= qty)
            .values(freezes=User.freezes - qty)
        )
        short = _NO_FREEZES
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN_ITEM)

    res = await db.execute(stmt)
    if res.rowcount == 0:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=short)
    await db.commit()
    await db.refresh(user)
    return user
