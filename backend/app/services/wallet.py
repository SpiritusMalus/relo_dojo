"""Koku wallet — server-authoritative economy (monetization plan, branch 1).

Earning and spending both happen here so the client can never set a balance:
- `award_correct_check` credits koku for a correct /check answer (authenticated callers only).
- `spend` debits coins / consumes items atomically (guarded UPDATE — no read-modify-write race).

Catalog items:
- "omamori"     buy a streak-freeze charm: coins -= PRICE_OMAMORI * qty, freezes += qty
- "use_freeze"  consume an owned charm (streak logic, branch 3): freezes -= qty, no coin cost
- "extra_pack"  +EXTRA_PACK_SIZE exercises for TODAY (free tier): coins -= PRICE_EXTRA_PACK * qty,
                today's used-counter -= size (may go negative = extra headroom; resets next day)
- "streak_repair"  buy back a broken daily streak; qty = the LOST streak length, price =
                min(REPAIR_BASE + REPAIR_PER_DAY * qty, REPAIR_MAX). The streak itself lives in the
                client progress snapshot; the server only charges. (Known limit: qty is
                client-reported — understating it lowers the price. Acceptable while the snapshot
                is client-owned JSONB; tighten if the streak ever moves server-side.)
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
    # Black Belt perk: double koku per correct answer.
    earned = settings.COIN_REWARD_CORRECT * (2 if user.is_premium else 1)
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
    if item in ("omamori", "omamori_promo"):
        price = settings.PRICE_OMAMORI_PROMO if item == "omamori_promo" else settings.PRICE_OMAMORI
        cost = price * qty
        stmt = (
            update(User)
            .where(User.id == user.id, User.coins >= cost)
            .values(coins=User.coins - cost, freezes=User.freezes + qty)
        )
        short = _NOT_ENOUGH
    elif item in ("extra_pack", "extra_pack_promo"):
        # Two-step on purpose: the coin debit is the guarded (race-safe) part; the quota bump is a
        # plain ORM update on the already-loaded row, committed together with the debit below.
        from .gating import _normalize_day  # local import — avoids a module cycle

        cost = settings.PRICE_EXTRA_PACK * qty
        stmt = (
            update(User)
            .where(User.id == user.id, User.coins >= cost)
            .values(coins=User.coins - cost)
        )
        short = _NOT_ENOUGH
        res = await db.execute(stmt)
        if res.rowcount == 0:
            await db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=short)
        _normalize_day(user)
        # Promo: double pack for the same price (FOMO limit offer).
        size = settings.EXTRA_PACK_SIZE * (2 if item == "extra_pack_promo" else 1)
        user.starter_used -= size * qty
        await db.commit()
        await db.refresh(user)
        return user
    elif item == "streak_repair":
        cost = min(settings.REPAIR_BASE + settings.REPAIR_PER_DAY * qty, settings.REPAIR_MAX)
        stmt = (
            update(User)
            .where(User.id == user.id, User.coins >= cost)
            .values(coins=User.coins - cost)
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
