"""Server-side access gating for unverified accounts.

Mirrors the client lock so it can't be bypassed by calling the API directly: unverified users get a
small daily *starter* quota of exercises and no stories. Verified users (and anonymous callers, which
have no account to gate) pass through untouched.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User

_ACTIVATE = "Activate your account (check your email) to unlock this."


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def consume_starter_exercise(user: User | None, db: AsyncSession) -> None:
    """Count one exercise against an unverified user's daily starter quota; 403 when exhausted.

    No-op for anonymous (no account) or verified users."""
    if user is None or user.is_verified:
        return
    today = _utc_day()
    if user.starter_day != today:
        user.starter_day = today
        user.starter_used = 0
    if user.starter_used >= settings.STARTER_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Activate your account to keep practicing — the daily starter limit is reached.",
        )
    user.starter_used += 1
    await db.commit()


def require_verified(user: User | None) -> None:
    """Block a feature for unverified accounts (e.g. stories). No-op for anonymous/verified."""
    if user is not None and not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_ACTIVATE)
