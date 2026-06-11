"""Stage 2 agent endpoints: post-session Progress Agent + trigger-based Planner.

Both require auth (they read/write the caller's learner profile) and run through the active
LLM provider. The client fires /agent/progress after a session (fire-and-forget) and
/agent/plan when a trigger says the plan is stale (new goal / lapse / error spike / weekly)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import LearnerProfileData, PlanData, PlanIn, ProgressAgentOut, SessionIn
from ..services import agents, learner_profile
from ..services.llm import LLMError

router = APIRouter(prefix="/agent", tags=["agents"])


@router.post("/progress", response_model=ProgressAgentOut)
async def agent_progress(
    payload: SessionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProgressAgentOut:
    """Session answers → updated weak-spot memory + a learner-facing 'wins' line."""
    profile = await learner_profile.get_data(user, db) or LearnerProfileData()
    try:
        profile = await agents.run_progress_agent(profile, payload.answers, payload.lang)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await learner_profile.upsert(user, db, profile)
    return ProgressAgentOut(weakSpots=profile.weakSpots, wins=profile.wins)


@router.post("/plan", response_model=PlanData)
async def agent_plan(
    payload: PlanIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlanData:
    """Profile + per-topic stats → a week's plan (topic weights + focus note), saved + returned."""
    profile = await learner_profile.get_data(user, db) or LearnerProfileData()
    try:
        profile = await agents.run_planner(profile, payload.stats, payload.lang)
    except LLMError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await learner_profile.upsert(user, db, profile)
    assert profile.plan is not None  # run_planner always sets it
    return profile.plan
