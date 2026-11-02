"""Account-bound authored chapters; only this router issues chapter preparation."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db, llm_rate_limit
from ..schemas import ChapterFinalIn, ChapterFinalOut, ChapterRunOut, ChaptersOut, ChapterStartIn
from ..services import chapters, dojo
from ..services.llm import LLMError

router = APIRouter(prefix="/chapters", tags=["chapters"], dependencies=[Depends(dojo.ensure_enabled)])


@router.get("", response_model=ChaptersOut)
async def catalog(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ChaptersOut:
    return await chapters.catalog(user, db)


@router.post("/{chapter_id}/start", response_model=ChapterRunOut)
async def start(chapter_id: str, payload: ChapterStartIn, user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_db)) -> ChapterRunOut:
    # client_id is a retry identity, never completion evidence. The unique owner/manifest run is
    # stronger: a fresh client id or a second device resumes the same work.
    return await chapters.start(user, db, chapter_id, payload.lang)


@router.get("/runs/{run_id}", response_model=ChapterRunOut)
async def state(run_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ChapterRunOut:
    return await chapters.state(user, db, run_id)


@router.post("/runs/{run_id}/final", response_model=ChapterFinalOut, dependencies=[Depends(llm_rate_limit)])
async def final(run_id: UUID, payload: ChapterFinalIn, user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_db)) -> ChapterFinalOut:
    try:
        return await chapters.submit(user, db, run_id, payload.submission_id, payload.text)
    except LLMError as exc:
        raise HTTPException(503, detail="Your reply could not be checked. Please try again.") from exc
