"""Relo Dojo backend — Phase 4.

Public (no auth):
- GET  /health       -> {"status": "ok"}
- POST /exercise     -> generate an exercise (interactive or free-text)
- POST /story        -> generate a themed mini-story (a sequence of linked exercises)
- POST /check        -> deterministic grade of an interactive answer (no LLM)
- POST /check-answer -> LLM grade of a free-text answer + explanation
- POST /explain      -> on-demand LLM teaching note for an interactive miss

Accounts (Phase 4):
- POST /auth/register, /auth/login ; GET /auth/me
- GET/PUT /progress  (require a Bearer token)

The LLM is routed by LLM_PROVIDER (.env): ollama (local dev, default) | anthropic | openai.
"""

import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .core.config import settings
from .db.models import User
from .deps import get_current_user, get_current_user_optional, get_db, llm_rate_limit
from .routers import agents as agents_router
from .routers import auth as auth_router
from .routers import billing as billing_router
from .routers import contracts as contracts_router
from .routers import cosmetics as cosmetics_router
from .routers import events as events_router
from .routers import profile as profile_router
from .routers import progress as progress_router
from .routers import voice as voice_router
from .routers import wallet as wallet_router
from .schemas import (
    AnalyzeIn,
    AnalyzeOut,
    CheckIn,
    CheckOut,
    CheckTextIn,
    CheckTextOut,
    ExerciseIn,
    ExerciseOut,
    ExplainIn,
    ExplainOut,
    ReviewIn,
    ContentBuyOut,
    ContentIn,
    ReviewOut,
    WritingAssessIn,
    WritingAssessOut,
    AdRewardOut,
    ScrollOut,
    StoryArcOut,
    StoryCatalogOut,
    StoryIn,
    StoryOut,
)
from .services import ads, analytics, content, gating, grammar, learner_profile, miss_log, rewards, stories, tokens
from .services import wallet as wallet_service
from .services.llm import LLMError as OllamaError  # one exception across providers
from .services.llm import generate_stream as llm_generate_stream

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Schema always matches the code: `alembic upgrade head` on boot (AUTO_MIGRATE to disable)."""
    if settings.AUTO_MIGRATE:
        try:
            # Worker thread: alembic is sync and its env.py calls asyncio.run() internally.
            await asyncio.get_running_loop().run_in_executor(None, run_migrations)
            logging.getLogger("uvicorn.error").info("Alembic migrations applied (auto-migrate).")
        except Exception:  # pragma: no cover — never block startup on a migration hiccup
            logging.getLogger("uvicorn.error").exception(
                "Auto-migrate failed — run `alembic upgrade head` manually."
            )
    # Events TTL: bound the append-only analytics table so it can't grow without limit.
    cutoff = analytics.retention_cutoff(datetime.now(timezone.utc), settings.EVENTS_TTL_DAYS)
    if cutoff is not None:  # pragma: no cover — opt-in, exercised live not in unit tests
        try:
            from .db.base import SessionLocal

            async with SessionLocal() as db:
                purged = await analytics.purge_old_events(db, cutoff)
            logging.getLogger("uvicorn.error").info("Events TTL purge: removed %d row(s).", purged)
        except Exception:  # never block startup on a cleanup hiccup
            logging.getLogger("uvicorn.error").exception("Events TTL purge failed — skipping.")
    yield


def _docs_kwargs(is_prod: bool) -> dict[str, Optional[str]]:
    """Swagger/OpenAPI is served only in dev. In prod we don't publish the API schema (it's free
    recon for an attacker) — `/docs`, `/redoc`, `/openapi.json` all 404."""
    if is_prod:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


app = FastAPI(title="Relo Dojo API", version="0.4.0", lifespan=lifespan, **_docs_kwargs(settings.is_prod))


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Defence-in-depth response headers (RD-08). Kept narrow so they're safe on every surface,
    including the dev Swagger UI and the /auth/verify HTML page: no CSP here — a correct policy has
    to account for that HTML/JS surface, so it lives at the reverse proxy (Caddy/nginx) at deploy.
    HSTS is prod-only (it only makes sense over HTTPS)."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if settings.is_prod:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
        )
    return response


# CORS origins are explicit (configured via ALLOWED_ORIGINS) — no wildcard in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents_router.router)
app.include_router(auth_router.router)
app.include_router(billing_router.router)
app.include_router(contracts_router.router)
app.include_router(cosmetics_router.router)
app.include_router(events_router.router)
app.include_router(profile_router.router)
app.include_router(progress_router.router)
app.include_router(voice_router.router)
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/exercise", response_model=ExerciseOut, dependencies=[Depends(llm_rate_limit)])
async def exercise(
    payload: ExerciseIn = ExerciseIn(),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> ExerciseOut:
    """Adaptive exercise. Daily quota is server-enforced per tier: unverified = starter,
    verified free = FREE_DAILY_LIMIT, premium/anonymous = unmetered."""
    # Reject a capped caller up front (cheap, read-only) so we never spend an LLM call on a request
    # that can't be served; meter only AFTER a successful generation, so a 503 / retried generation
    # never burns the user's daily quota.
    gating.ensure_daily_quota(user)
    # "About my life": when the client didn't supply a context, compose one from the learner's OWN
    # server-side profile (goal / field / interests + weak-spot summary) so generation quietly leans
    # toward their world — the rich memory already exists, it just never reached /exercise. A
    # client-supplied context always wins (a future scene picker stays authoritative); anonymous and
    # no-profile callers are unchanged. Gated on the recorded 152-ФЗ cross-border consent so profile
    # text only egresses to the LLM for users who provably accepted the transfer.
    context = payload.context
    if not (context or "").strip() and user is not None and user.pd_consent_at is not None:
        prof = await learner_profile.get_data(user, db)
        context = learner_profile.context_for(prof)
    # Cross-device personalization: top up the per-topic miss hints from the server-side miss log
    # when the client sends fewer than MAX_MISTAKE_HINTS (fresh install / new device — the local
    # Review deck is empty, but the server remembers). Client hints always lead; same 152-ФЗ egress
    # gate as the profile context above. Only for a canonical client-chosen topic — when generation
    # picks the topic itself, we can't know it here.
    mistakes = payload.mistakes
    if (
        user is not None
        and user.pd_consent_at is not None
        and payload.topic in grammar._TOPIC_NAMES
        and len(mistakes) < grammar.MAX_MISTAKE_HINTS
    ):
        server_hints = await miss_log.recent_misses(
            db, user, payload.topic, limit=grammar.MAX_MISTAKE_HINTS
        )
        if server_hints:
            mistakes = miss_log.merge_hints(mistakes, server_hints, cap=grammar.MAX_MISTAKE_HINTS)
    try:
        data = await grammar.generate_exercise(
            topic=payload.topic,
            level=payload.level,
            ex_type=payload.type,
            context=context,
            mistakes=mistakes,
            lang=payload.lang,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await gating.consume_daily_exercise(user, db)
    # grammar guarantees keys; the answer stays sealed in `token`, never in plaintext here.
    return ExerciseOut(**data)


@app.post("/story", response_model=StoryOut, dependencies=[Depends(llm_rate_limit)])
async def story(
    payload: StoryIn = StoryIn(),
    user: Optional[User] = Depends(get_current_user_optional),
) -> StoryOut:
    """Themed mini-story (a sequence of linked exercises). Open to everyone, incl. anonymous users
    (Duo-style generous taste — content gating lives in services/access.py, and stories are open).

    Each beat's answer stays sealed in its own `token` and is graded by the existing /check.
    A specific `id` selects an arc; premium arcs require the matching content unlock (403 otherwise).
    """
    owned = set(content.owned_ids(user)) if user is not None else set()
    if payload.id:
        scenario = stories._BY_ID.get(payload.id)
        if scenario is None:
            raise HTTPException(status_code=404, detail="Unknown story.")
        if not stories.is_available(scenario, owned):
            raise HTTPException(status_code=403, detail="This arc is locked. Unlock it with koku.")
    try:
        data = await stories.build_story(
            level=payload.level, context_override=payload.context, scenario_id=payload.id, lang=payload.lang
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return StoryOut(**data)


@app.get("/story/catalog", response_model=StoryCatalogOut)
async def story_catalog(
    user: Optional[User] = Depends(get_current_user_optional),
) -> StoryCatalogOut:
    """Story arcs with lock/own/price + today's featured pick (the "today's different" rotation)."""
    owned = set(content.owned_ids(user)) if user is not None else set()
    subject = str(user.id) if user is not None else "anon"
    featured = stories.featured_story_id(subject, gating._utc_day(), owned)
    arcs = []
    for s in stories.SCENARIOS:
        unlock = s.get("unlock")
        is_owned = unlock is None or unlock in owned
        price = content.CATALOG.get(unlock, {}).get("price", 0) if unlock else 0
        arcs.append(
            StoryArcOut(
                id=s["id"],
                title=s["title"],
                intro=s["intro"],
                locked=not is_owned,
                owned=is_owned,
                price=price,
                featured=s["id"] == featured,
            )
        )
    return StoryCatalogOut(featured_id=featured, arcs=arcs)


@app.post("/content/buy", response_model=ContentBuyOut)
async def content_buy(
    payload: ContentIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContentBuyOut:
    """Unlock premium content with koku. 400 unknown; 409 insufficient koku."""
    user = await content.buy(user, db, payload.id)
    return ContentBuyOut(owned=content.owned_ids(user), coins=user.coins)


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
    coins_earned, coins, first_win_bonus, combo_bonus = 0, None, 0, 0
    if result.get("correct"):
        # One-time-use: key the koku award on the token's hash so resubmitting the same correct
        # token can't farm coins (anti-replay; see wallet.award_correct_check).
        jti = hashlib.sha256(payload.token.encode()).hexdigest()
        coins_earned, coins, first_win_bonus, combo_bonus = await wallet_service.award_correct_check(
            user, db, jti=jti
        )
    else:
        # A wrong answer breaks the consecutive-correct combo run (server-side).
        await wallet_service.reset_correct_run(user, db)
        # ...and lands in the server-side miss log (newer tokens carry topic + a drill sentence;
        # older ones no-op here and still grade fine). Feeds /exercise personalization cross-device.
        await miss_log.record_miss(
            db, user, sealed.get("topic"), sealed.get("text") or sealed.get("sentence")
        )
    return CheckOut(
        **result,
        coins_earned=coins_earned,
        coins=coins,
        first_win_bonus=first_win_bonus,
        combo_bonus=combo_bonus,
    )


@app.post("/check-answer", response_model=CheckTextOut, dependencies=[Depends(llm_rate_limit)])
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


@app.post("/explain", response_model=ExplainOut, dependencies=[Depends(llm_rate_limit)])
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


@app.post("/explain/stream", dependencies=[Depends(llm_rate_limit)])
async def explain_stream(
    payload: ExplainIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Streaming variant of /explain: the teaching note streams in token-by-token for perceived
    speed (plain text). Same profile-aware prompt; the structured /explain stays for callers that
    need {explanation, tip}. On Ollama this is true token streaming; API providers send one chunk."""
    prof = await learner_profile.get_data(user, db)
    prompt = grammar.explain_text_prompt(
        payload.text,
        payload.correct_answer,
        payload.user_response,
        payload.lang,
        tone=prof.tone if prof else None,
        weak_spots=prof.weakSpots if prof else None,
    )

    async def _stream():
        try:
            async for chunk in llm_generate_stream(prompt, temperature=0.2):
                yield chunk
        except OllamaError as exc:
            # The response is already 200/streaming, so surface the failure inline as text.
            yield f"\n[unavailable: {exc}]"

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


@app.post("/review-text", response_model=ReviewOut, dependencies=[Depends(llm_rate_limit)])
async def review_text(
    payload: ReviewIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> ReviewOut:
    """"Review my text" (Stage 3): the learner pastes their REAL email/message → graded breakdown
    vs their weak spots. Open to everyone; the analysis is returned to anonymous callers too, but
    findings are only persisted to the learner profile when the request is authenticated."""
    prof = await learner_profile.get_data(user, db)
    try:
        data = await grammar.review_text(
            payload.text,
            payload.lang,
            tone=prof.tone if prof else None,
            weak_spots=prof.weakSpots if prof else None,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    topics = list(dict.fromkeys(i["topic"] for i in data["issues"]))
    if user is not None and topics:
        await learner_profile.save_review(user, db, topics)
    return ReviewOut(**data, topics=topics)


@app.post("/assess-writing", response_model=WritingAssessOut, dependencies=[Depends(llm_rate_limit)])
async def assess_writing(
    payload: WritingAssessIn,
    user: Optional[User] = Depends(get_current_user_optional),
) -> WritingAssessOut:
    """Level Test writing section: place a short written response on the CEFR scale (productive skill).
    Open to everyone; stateless (no profile write) — the client folds the score into the overall level."""
    try:
        data = await grammar.assess_writing(payload.text, payload.prompt, payload.lang)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return WritingAssessOut(**data)


@app.post("/rewards/scroll", response_model=ScrollOut)
async def open_scroll(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScrollOut:
    """Open one reward scroll (end of a session). Server-rolled and server-credited — the variable
    prize is the comeback hook, the daily cap is the farm guard."""
    return ScrollOut(**await rewards.grant_scroll(user, db))


@app.post("/ads/reward", response_model=AdRewardOut)
async def ad_reward(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdRewardOut:
    """Credit koku for a completed rewarded ad (server-authoritative, daily-capped). Disabled by
    default (ADS_REWARDS_PER_DAY=0) until the ad SDK + server-side verification are wired — see
    services/ads.py. Requires an account (anonymous users have no wallet to credit)."""
    return AdRewardOut(**await ads.grant_rewarded(user, db))


@app.post("/dev/premium")
async def dev_premium_toggle(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """DEV ONLY: flip the caller's comp ("Black Belt forever") flag (guarded by DEV_PREMIUM_TOGGLE,
    off by default). Toggles the manual override; paid subscriptions (premium_until) come from the
    billing webhooks instead. `is_premium` in the response is the effective property (override OR a
    live paid sub)."""
    if not settings.DEV_PREMIUM_TOGGLE:
        raise HTTPException(status_code=404, detail="Not found.")
    user.premium_override = not user.premium_override
    await db.commit()
    return {"is_premium": user.is_premium}


@app.post("/profile/analyze", response_model=AnalyzeOut, dependencies=[Depends(llm_rate_limit)])
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
