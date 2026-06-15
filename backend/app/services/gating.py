"""Server-side access gating: daily exercise metering per account tier.

Mirrors the client lock so it can't be bypassed by calling the API directly. Tiers:
- anonymous        unmetered (no account to gate)
- premium          unmetered ("Black Belt" — the upsell is exactly this)
- verified free    FREE_DAILY_LIMIT exercises / UTC day, then 403 {code: "daily_limit"}
- unverified       STARTER_DAILY_LIMIT / UTC day, then 403 {code: "starter_limit"}

Feature-level access (which modes need an account/premium) lives in services/access.py — this
module only meters the daily exercise quota.

The 403 detail is a dict so the client can route the paywall (buy an extra pack / go premium)
vs the activation prompt. `starter_day`/`starter_used` columns meter BOTH free tiers (one counter,
different caps). Buying an "extra_pack" in the shop lowers `starter_used`, raising today's headroom.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User


def _utc_day() -> str:
    """The calendar day used for daily resets. Applies DAY_OFFSET_MIN so the limit can roll over
    on the users' local midnight instead of UTC (default offset 0 = plain UTC)."""
    return (datetime.now(timezone.utc) + timedelta(minutes=settings.DAY_OFFSET_MIN)).strftime("%Y-%m-%d")


def _normalize_day(user: User) -> None:
    """Reset the daily counter when the UTC day rolled over."""
    today = _utc_day()
    if user.starter_day != today:
        user.starter_day = today
        user.starter_used = 0


def daily_limit_for(user: User) -> int | None:
    """Today's exercise cap for the account; None = unlimited (premium)."""
    if user.is_premium:
        return None
    return settings.FREE_DAILY_LIMIT if user.is_verified else settings.STARTER_DAILY_LIMIT


def left_today(user: User | None) -> int | None:
    """Exercises remaining today; None = unmetered (anonymous/premium). Never negative."""
    if user is None:
        return None
    limit = daily_limit_for(user)
    if limit is None:
        return None
    used = user.starter_used if user.starter_day == _utc_day() else 0
    return max(0, limit - used)


async def consume_daily_exercise(user: User | None, db: AsyncSession) -> None:
    """Count one exercise against the account's daily quota; 403 when exhausted.

    No-op for anonymous and premium callers."""
    if user is None or user.is_premium:
        return
    # Row-lock the account for the read-modify-write below so two concurrent exercise requests
    # can't both pass the cap check and both increment (which would over-serve the daily quota).
    # The lock is released by the commit at the end of this function.
    await db.refresh(user, with_for_update=True)
    _normalize_day(user)
    limit = daily_limit_for(user)
    assert limit is not None  # premium returned above
    if user.starter_used >= limit:
        code = "daily_limit" if user.is_verified else "starter_limit"
        message = (
            "Daily limit reached — buy an extra pack in the shop or go premium for unlimited practice."
            if user.is_verified
            else "Activate your account to keep practicing — the daily starter limit is reached."
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": code, "left": 0, "message": message},
        )
    user.starter_used += 1
    await db.commit()
