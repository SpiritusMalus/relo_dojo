"""Progress sync endpoints (Phase 4): GET current snapshot, PUT to replace it.

Server is canonical. The client merges (max) on first login and then pushes its snapshot here.
One JSONB row per user.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Progress, User
from ..deps import get_current_user, get_db
from ..schemas import ProgressData

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("", response_model=ProgressData)
async def get_progress(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ProgressData:
    row = await db.get(Progress, user.id)
    if row is None:
        return ProgressData()  # new account → empty default snapshot
    return ProgressData(**row.data)


@router.put("", response_model=ProgressData)
async def put_progress(
    payload: ProgressData,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProgressData:
    data = payload.model_dump()
    row = await db.get(Progress, user.id)
    if row is None:
        db.add(Progress(user_id=user.id, data=data))
    else:
        row.data = data
    await db.commit()
    return payload
