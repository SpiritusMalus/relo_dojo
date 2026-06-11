"""Learner profile endpoints (Praktika adoption Stage 1): GET/PUT the server-side memory layer.

Server is canonical for tone / goal / weak spots so every device (and, in Stage 2, every agent)
reads the same learner. /profile/analyze (goal intake) stays in main.py — it is public and only
*optionally* persists for authenticated callers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import LearnerProfileData
from ..services import learner_profile

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=LearnerProfileData)
async def get_profile(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> LearnerProfileData:
    return await learner_profile.get_data(user, db) or LearnerProfileData()


@router.put("", response_model=LearnerProfileData)
async def put_profile(
    payload: LearnerProfileData,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LearnerProfileData:
    return await learner_profile.upsert(user, db, payload)
