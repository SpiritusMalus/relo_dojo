"""Authenticated, additive My Dojo projection and practice completion contracts."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import DojoState, DojoTargetIn, LearningCompletionOut, LearningSessionIn, LearningSessionOut
from ..services import dojo

router = APIRouter(prefix="/dojo", tags=["dojo"], dependencies=[Depends(dojo.ensure_enabled)])


@router.get("", response_model=DojoState)
async def get_dojo(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> DojoState:
    return await dojo.state(user, db)


@router.post("/target", response_model=DojoState)
async def target(payload: DojoTargetIn, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> DojoState:
    return await dojo.select_target(user, db, payload.id)


@router.post("/receipts/{receipt_id}/ack", response_model=DojoState)
async def acknowledge(receipt_id: UUID, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> DojoState:
    return await dojo.acknowledge(user, db, receipt_id)


@router.post("/sessions", response_model=LearningSessionOut)
async def start(payload: LearningSessionIn, user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_db)) -> LearningSessionOut:
    return dojo.session_out(await dojo.start_session(user, db, payload.client_id))


@router.get("/sessions/{session_id}", response_model=LearningSessionOut)
async def get_session(session_id: UUID, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> LearningSessionOut:
    return dojo.session_out(await dojo.get_session(user, db, session_id))


@router.post("/sessions/{session_id}/complete", response_model=LearningCompletionOut)
async def complete(session_id: UUID, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> LearningCompletionOut:
    row = await dojo.complete_session(user, db, session_id)
    return LearningCompletionOut(session=dojo.session_out(row), dojo=await dojo.state(user, db))


@router.post("/sessions/{session_id}/abandon", response_model=LearningSessionOut)
async def abandon(session_id: UUID, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)) -> LearningSessionOut:
    return dojo.session_out(await dojo.abandon_session(user, db, session_id))
