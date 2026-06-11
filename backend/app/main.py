"""Grammar Dojo backend — Phase 4.

Public (no auth):
- GET  /health       -> {"status": "ok"}
- POST /chat         -> free chat with the model (Phase 1)
- POST /exercise     -> generate an exercise (interactive or free-text)
- POST /story        -> generate a themed mini-story (a sequence of linked exercises)
- POST /check        -> deterministic grade of an interactive answer (no LLM)
- POST /check-answer -> LLM grade of a free-text answer + explanation
- POST /explain      -> on-demand LLM teaching note for an interactive miss

Accounts (Phase 4):
- POST /auth/register, /auth/login ; GET /auth/me
- GET/PUT /progress  (require a Bearer token)

The LLM is self-hosted Ollama; the model is set via OLLAMA_MODEL in .env.
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from .core.config import settings
from .db.models import User
from .deps import get_current_user, get_current_user_optional, get_db
from .routers import auth as auth_router
from .routers import profile as profile_router
from .routers import progress as progress_router
from .routers import wallet as wallet_router
from .schemas import (
    AnalyzeIn,
    AnalyzeOut,
    ChatIn,
    ChatOut,
    CheckIn,
    CheckOut,
    CheckTextIn,
    CheckTextOut,
    ExerciseIn,
    ExerciseOut,
    ExplainIn,
    ExplainOut,
    ScrollOut,
    StoryIn,
    StoryOut,
)
from .services import gating, grammar, learner_profile, rewards, stories, tokens
from .services import wallet as wallet_service
from .services.ollama_client import OllamaError, generate

app = FastAPI(title="Grammar Dojo API", version="0.4.0")

# CORS origins are explicit (configured via ALLOWED_ORIGINS) — no wildcard in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(profile_router.router)
app.include_router(progress_router.router)
app.include_router(wallet_router.router)


def run_migrations() -> None:
    """Apply pending Alembic migrations (sync; called in a worker thread on startup).

    Paths are resolved from this file so it works regardless of the process cwd."""
    from alembic import command
    from alembic.config import Config as AlembicConfig

    root = Path(__file__).resolve().parents[1]  # backend/
    cfg = AlembicConfig(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")


@app.on_event("startup")
async def startup_migrate() -> None:
    """Schema always matches the code: `alembic upgrade head` on boot (AUTO_MIGRATE to disable)."""
    if not settings.AUTO_MIGRATE:
        return
    try:
        # Worker thread: alembic is sync and its env.py calls asyncio.run() internally.
        await asyncio.get_running_loop().run_in_executor(None, run_migrations)
        logging.getLogger("uvicorn.error").info("Alembic migrations applied (auto-migrate).")
    except Exception:  # pragma: no cover — never block startup on a migration hiccup
        logging.getLogger("uvicorn.error").exception(
            "Auto-migrate failed — run `alembic upgrade head` manually."
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatOut)
async def chat(payload: ChatIn) -> ChatOut:
    try:
        reply = await generate(payload.message)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatOut(reply=reply)


@app.post("/exercise", response_model=ExerciseOut)
async def exercise(
    payload: ExerciseIn = ExerciseIn(),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> ExerciseOut:
    """Adaptive exercise. Daily quota is server-enforced per tier: unverified = starter,
    verified free = FREE_DAILY_LIMIT, premium/anonymous = unmetered."""
    await gating.consume_daily_exercise(user, db)
    try:
        data = await grammar.generate_exercise(
            topic=payload.topic,
            level=payload.level,
            ex_type=payload.type,
            context=payload.context,
            mistakes=payload.mistakes,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # grammar guarantees keys; the answer stays sealed in `token`, never in plaintext here.
    return ExerciseOut(**data)


@app.post("/story", response_model=StoryOut)
async def story(
    payload: StoryIn = StoryIn(),
    user: Optional[User] = Depends(get_current_user_optional),
) -> StoryOut:
    """Themed mini-story (a sequence of linked exercises). Blocked for unverified accounts.

    Each beat's answer stays sealed in its own `token` and is graded by the existing /check.
    """
    gating.require_verified(user)
    try:
        data = await stories.build_story(level=payload.level, context_override=payload.context)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return StoryOut(**data)


@app.post("/check", response_model=CheckOut)
async def check(
    payload: CheckIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> CheckOut:
    """Deterministic grade for interactive types. No LLM — instant and reliable.

    Economy: a correct answer earns koku for authenticated callers (server-authoritative —
    the wallet can only grow here, never via the client). Anonymous callers grade as before."""
    try:
        sealed = tokens.unseal(payload.token)
    except tokens.TokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = grammar.grade(sealed, payload.response)
    coins_earned, coins = 0, None
    if result.get("correct"):
        coins_earned, coins = await wallet_service.award_correct_check(user, db)
    return CheckOut(**result, coins_earned=coins_earned, coins=coins)


@app.post("/check-answer", response_model=CheckTextOut)
async def check_answer(
    payload: CheckTextIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> CheckTextOut:
    """LLM grade + feedback. Authenticated callers get profile-aware feedback (tone + history)."""
    prof = await learner_profile.get_data(user, db)
    try:
        data = await grammar.check_answer(
            payload.text,
            payload.user_answer,
            payload.lang,
            tone=prof.tone if prof else None,
            weak_spots=prof.weakSpots if prof else None,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return CheckTextOut(**data)


@app.post("/explain", response_model=ExplainOut)
async def explain(
    payload: ExplainIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> ExplainOut:
    """Teaching note for a miss. Authenticated callers get profile-aware feedback (tone + history)
    retrieved at feedback time — the tutor reacts to the CURRENT slip with memory of past ones."""
    prof = await learner_profile.get_data(user, db)
    try:
        data = await grammar.explain(
            payload.text,
            payload.correct_answer,
            payload.user_response,
            payload.lang,
            tone=prof.tone if prof else None,
            weak_spots=prof.weakSpots if prof else None,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ExplainOut(**data)


@app.post("/rewards/scroll", response_model=ScrollOut)
async def open_scroll(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScrollOut:
    """Open one reward scroll (end of a session). Server-rolled and server-credited — the variable
    prize is the comeback hook, the daily cap is the farm guard."""
    return ScrollOut(**await rewards.grant_scroll(user, db))


@app.post("/dev/premium")
async def dev_premium_toggle(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """DEV ONLY: flip the caller's premium flag (guarded by DEV_PREMIUM_TOGGLE, off by default).
    In prod the flag is owned by the payment provider integration (Phase 7/8)."""
    if not settings.DEV_PREMIUM_TOGGLE:
        raise HTTPException(status_code=404, detail="Not found.")
    user.is_premium = not user.is_premium
    await db.commit()
    return {"is_premium": user.is_premium}


@app.post("/profile/analyze", response_model=AnalyzeOut)
async def analyze(
    payload: AnalyzeIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> AnalyzeOut:
    """Goal intake: map a free-text goal/'what's hard for me' to canonical grammar topics.
    Public; for authenticated callers the goal is also persisted into the learner profile
    (current goal + bounded history) — onboarding AND 'change my goal' in settings both land here."""
    try:
        topics = await grammar.analyze_pain(payload.text)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    saved = False
    if user is not None:
        await learner_profile.save_goal(user, db, payload.text.strip(), topics)
        saved = True
    return AnalyzeOut(topics=topics, saved=saved)
