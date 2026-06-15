"""Rewarded-ad koku grant — server-authoritative reward for opting into a rewarded video.

Mirrors rewards.py: the SERVER credits the koku (the client only signals "the rewarded ad
finished"), with a per-account daily cap so a patched client can't farm the reward.

SAFETY — read before enabling in production:
Granting koku on the client's word is farmable. ``ADS_REWARDS_PER_DAY`` is 0 (disabled) by default.
Before raising it, wire the ad network's server-side verification (SSV) callback (AdMob / AppLovin):
the network calls your backend on a verified completion, and only THEN do you grant. The daily cap
here is a damage limiter, not a substitute for SSV.

Interstitial ads are a pure client concern (just don't show them) and are gated by the ``no_ads``
feature in services/access.py — premium removes them. They never touch the server.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User
# Single source of truth for the daily-reset calendar day (honors DAY_OFFSET_MIN).
from .gating import _utc_day


async def grant_rewarded(user: User, db: AsyncSession) -> dict:
    """Credit one rewarded-ad koku grant for the user.

    403 ``ads_disabled`` when the feature is off (cap <= 0); 403 ``ads_limit`` past the daily cap."""
    cap = settings.ADS_REWARDS_PER_DAY
    if cap <= 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ads_disabled", "message": "Rewarded ads aren't available yet."},
        )
    # Row-lock the account: the daily cap is the farm guard, so concurrent grants can't both pass
    # the cap check and both credit koku. Released by the commit below.
    await db.refresh(user, with_for_update=True)
    today = _utc_day()
    if user.ad_reward_day != today:
        user.ad_reward_day = today
        user.ad_rewards_used = 0
    if user.ad_rewards_used >= cap:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ads_limit", "message": "No more ad rewards today — come back tomorrow."},
        )
    amount = settings.ADS_REWARD_KOKU
    user.ad_rewards_used += 1
    user.coins += amount
    await db.commit()
    await db.refresh(user)
    return {"amount": amount, "coins": user.coins, "left_today": max(0, cap - user.ad_rewards_used)}
