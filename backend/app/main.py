"""Relo Dojo backend — Phase 4.

Public (no auth):
- GET  /health       -> {"status": "ok"}
- POST /exercise     -> generate an exercise (interactive or free-text)
- POST /story        -> generate a themed mini-story (a sequence of linked exercises)
- POST /check        -> deterministic grade of an interactive answer (no LLM)
- POST /check-answer -> LLM grade of a free-text answer + explanation
- POST /check-retell -> LLM grade of a listen-and-retell answer (content coverage)
- POST /explain      -> on-demand LLM teaching note for an interactive miss
- POST /translate    -> tap-to-translate one English word/phrase into the learner's UI language

Accounts (Phase 4):
- POST /auth/register, /auth/login ; GET /auth/me
- GET/PUT /progress  (require a Bearer token)

The LLM is routed by LLM_PROVIDER (.env): ollama (local dev, default) | anthropic | openai.
"""

import asyncio
import hashlib
import logging
import os
import random
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from secrets import compare_digest
from typing import AsyncIterator, Coroutine, Optional, TypeVar

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .core.config import settings
from .db.models import User
from .deps import check_rate_limit, get_current_user, get_current_user_optional, get_db, llm_rate_limit
from .routers import agents as agents_router
from .routers import auth as auth_router
from .routers import billing as billing_router
from .routers import chapters as chapters_router
from .routers import contracts as contracts_router
from .routers import cosmetics as cosmetics_router
from .routers import dojo as dojo_router
from .routers import events as events_router
from .routers import profile as profile_router
from .routers import progress as progress_router
from .routers import voice as voice_router
from .routers import voice_conversation as voice_conversation_router
from .routers import wallet as wallet_router
from .schemas import (
    AnalyzeIn,
    AnalyzeOut,
    CheckIn,
    CheckOut,
    CheckRetellIn,
    CheckTextIn,
    CheckTextOut,
    ExerciseIn,
    ExerciseOut,
    ExplainIn,
    ExplainOut,
    TranslateIn,
    TranslateOut,
    ReviewIn,
    ReviewExerciseTokenIn,
    ReviewExerciseTokenOut,
    ContentBuyOut,
    ContentIn,
    ReviewOut,
    WritingAssessIn,
    WritingAssessOut,
    AdRewardOut,
    ScrollOut,
    StoryArcOut,
    StoryBeatIn,
    StoryCatalogOut,
    StoryIn,
    StoryOut,
)
from .services import ads, analytics, chapters, content, dojo, gating, grammar, http_client, learner_profile, miss_log, rewards, stories, tokens
from .services import wallet as wallet_service
from .services._grammar_generators import AssessmentUnavailable, valid_assessment_spec
from .services.llm import LLMError as OllamaError  # one exception across providers
from .services.llm import generate_stream as llm_generate_stream

# Route app-level logs (services.llm telemetry, miss_log warnings) to stderr → journald. Under
# uvicorn only the uvicorn.* loggers get handlers — the root logger has none, so every app INFO
# line silently vanishes (verified on prod: an /exercise call logged no "llm ok"). basicConfig is
# a no-op when a root handler already exists (pytest, scripts), so dev tooling is unaffected.
logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")

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
        # Alembic's fileConfig() replaced the root logging config with alembic.ini's (root=WARNING),
        # filtering out app INFO telemetry. Re-assert ours now that migrations are done.
        logging.basicConfig(
            force=True, level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s"
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
    # Shutdown: release the pooled LLM HTTP connections (services.http_client).
    await http_client.aclose()


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
app.include_router(chapters_router.router)
app.include_router(contracts_router.router)
app.include_router(cosmetics_router.router)
app.include_router(dojo_router.router)
app.include_router(events_router.router)
app.include_router(profile_router.router)
app.include_router(progress_router.router)
app.include_router(voice_router.router)
app.include_router(voice_conversation_router.router)
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
def health(response: Response) -> dict[str, str]:
    # Set by the release launcher, so disk HEAD and the running process are verifiable separately.
    response.headers["X-Relo-Revision"] = os.environ.get("RELO_RELEASE_SHA", "unknown")
    return {"status": "ok"}


_Generated = TypeVar("_Generated")


async def _verify_request_connected(request: Request | None) -> None:
    if request is not None and await request.is_disconnected():
        raise HTTPException(499, detail="The request was cancelled.")


async def _generate_while_connected(
    request: Request | None, generation: Coroutine[object, object, _Generated],
) -> _Generated:
    if request is None:  # Direct service tests do not pass an ASGI request.
        return await generation

    finished = asyncio.Event()

    async def watch_disconnect() -> None:
        while not finished.is_set():
            await _verify_request_connected(request)
            # Starlette polls inside an AnyIO cancellation scope. Signal shutdown
            # explicitly instead of cancelling the poll task through that scope.
            try:
                await asyncio.wait_for(finished.wait(), timeout=0.15)
            except TimeoutError:
                continue

    model = asyncio.create_task(generation)
    monitor = asyncio.create_task(watch_disconnect())
    try:
        done, _ = await asyncio.wait((model, monitor), return_when=asyncio.FIRST_COMPLETED)
        if monitor in done:
            monitor.result()
        return model.result()
    finally:
        finished.set()
        model.cancel()
        await asyncio.gather(model, monitor, return_exceptions=True)


def _review_identity(user: User | None, request: Request | None) -> tuple[str | None, str | None]:
    return (
        str(user.id) if user is not None else None,
        request.headers.get("X-Relo-Review-Guest") if request is not None else None,
    )


def _check_token(
    token: str, user: User | None, request: Request | None,
) -> tuple[dict, bool]:
    try:
        data = tokens.unseal(token)
        if "story_resume" in data:
            raise tokens.TokenError("This token can only retry a story beat.")
        return data, tokens.validate_review(data, *_review_identity(user, request))
    except tokens.ReviewScopeError as exc:
        raise HTTPException(403, detail=str(exc)) from exc
    except tokens.TokenError as exc:
        raise HTTPException(400, detail={"code": "exercise_expired", "message": str(exc)}) from exc


@app.post("/exercise", response_model=ExerciseOut, dependencies=[Depends(llm_rate_limit)])
async def exercise(
    payload: ExerciseIn = ExerciseIn(),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
) -> ExerciseOut:
    """Adaptive exercise. Daily quota is server-enforced per tier: unverified = starter,
    verified free = FREE_DAILY_LIMIT, premium/anonymous = unmetered."""
    # Reject a capped caller up front (cheap, read-only) so we never spend an LLM call on a request
    # that can't be served; meter only AFTER a successful generation, so a 503 / retried generation
    # never burns the user's daily quota.
    if payload.assessment and not valid_assessment_spec(payload.topic, payload.level, payload.type):
        raise HTTPException(422, detail={
            "code": "invalid_assessment_spec", "message": "Choose a supported topic, format and level.",
        })
    await _verify_request_connected(request)
    await dojo.prepare_issue(user, db, payload.learning_session_id, payload.learning_item)
    gating.ensure_daily_quota(user)
    # "About my life": when the client didn't supply a context, compose one from the learner's OWN
    # server-side profile (goal / field / interests + weak-spot summary) so generation quietly leans
    # toward their world — the rich memory already exists, it just never reached /exercise. A
    # client-supplied context always wins (a future scene picker stays authoritative); anonymous and
    # no-profile callers are unchanged. Gated on the recorded 152-ФЗ cross-border consent so profile
    # text only egresses to the LLM for users who provably accepted the transfer.
    context = payload.context
    if not payload.assessment and not (context or "").strip() and user is not None and user.pd_consent_at is not None:
        prof = await learner_profile.get_data(user, db)
        context = learner_profile.context_for(prof)
    # Cross-device personalization: top up the per-topic miss hints from the server-side miss log
    # when the client sends fewer than MAX_MISTAKE_HINTS (fresh install / new device — the local
    # Review deck is empty, but the server remembers). Client hints always lead; same 152-ФЗ egress
    # gate as the profile context above. Only for a canonical client-chosen topic — when generation
    # picks the topic itself, we can't know it here.
    mistakes = [] if payload.assessment else payload.mistakes
    if (
        not payload.assessment
        and user is not None
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
        mode = {"assessment": True} if payload.assessment else {}
        data = await _generate_while_connected(request, grammar.generate_exercise(
            topic=payload.topic,
            level=payload.level,
            ex_type=payload.type,
            context=context,
            mistakes=mistakes,
            lang=payload.lang,
            practice_index=payload.practice_index,
            **mode,
        ))
    except AssessmentUnavailable as exc:
        raise HTTPException(503, detail={"code": "assessment_unavailable", "message": str(exc)}) from exc
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await _verify_request_connected(request)
    bound = payload.learning_session_id is not None and settings.DOJO_ENABLED
    if bound:
        data = await dojo.bind_exercise(user, db, payload.learning_session_id, payload.learning_item, data, payload.lang)
    data["learning_bound"] = bound
    exercise_out = ExerciseOut(**tokens.attach_review_token(data, *_review_identity(user, request)))
    await _verify_request_connected(request)
    await gating.consume_daily_exercise(user, db)
    return exercise_out


_STORY_RESUME_SECONDS = 2 * 60 * 60


def _require_available_story(scenario_id: str, owned: set[str]) -> None:
    scenario = stories._BY_ID.get(scenario_id)
    if scenario is None:
        raise HTTPException(404, detail="Unknown story.")
    if not stories.is_available(scenario, owned):
        raise HTTPException(403, detail="This arc is locked. Unlock it with koku.")


@app.post("/story", response_model=StoryOut, dependencies=[Depends(llm_rate_limit)])
async def story(
    payload: StoryIn = StoryIn(),
    user: Optional[User] = Depends(get_current_user_optional),
    request: Request = None,
) -> StoryOut:
    """Open a story with optional independent retries for beats that cannot be delivered."""
    owned = set(content.owned_ids(user)) if user is not None else set()
    scenario_id = payload.id or random.choice(stories.available_ids(owned))
    _require_available_story(scenario_id, owned)
    identity = _review_identity(user, request)
    scope = tokens._review_scope(*identity)
    if payload.allow_partial and scope is None:
        raise HTTPException(422, detail={
            "code": "story_scope_required", "message": "A learner identity is required to retry story beats.",
        })
    await _verify_request_connected(request)
    try:
        options = {"allow_partial": True} if payload.allow_partial else {}
        data = await _generate_while_connected(request, stories.build_story(
            level=payload.level, context_override=payload.context, scenario_id=scenario_id, lang=payload.lang,
            **options,
        ))
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    retry_formats = data.pop("retry_formats", {})
    if retry_formats:
        data["resume_token"] = tokens.seal({"story_resume": {
            "scope": scope, "scene": scenario_id, "level": data["level"], "context": payload.context,
            "lang": payload.lang, "retry_formats": retry_formats,
            "expires": int(datetime.now(timezone.utc).timestamp()) + _STORY_RESUME_SECONDS,
        }})
    for beat in data["beats"]:
        if beat["exercise"] is not None:
            beat["exercise"] = tokens.attach_review_token(beat["exercise"], *identity)
    return StoryOut(**data)


@app.post("/story/beat", response_model=ExerciseOut, dependencies=[Depends(llm_rate_limit)])
async def story_beat(
    payload: StoryBeatIn,
    user: Optional[User] = Depends(get_current_user_optional),
    request: Request = None,
) -> ExerciseOut:
    """Regenerate only a missing beat within the original story and learner scope."""
    try:
        resume = tokens.unseal(payload.resume_token).get("story_resume")
    except tokens.TokenError:
        resume = None
    if (not isinstance(resume, dict) or not isinstance(resume.get("expires"), int)
            or resume["expires"] <= datetime.now(timezone.utc).timestamp()):
        raise HTTPException(400, detail={
            "code": "story_resume_expired", "message": "This story can no longer retry missing beats.",
        })
    identity = _review_identity(user, request)
    scope = tokens._review_scope(*identity)
    if scope is None or not compare_digest(scope, resume["scope"]):
        raise HTTPException(403, detail="This story belongs to another learner.")
    kind = resume["retry_formats"].get(str(payload.index))
    if kind is None:
        raise HTTPException(409, detail={
            "code": "story_beat_already_available", "message": "This beat is already available in the story.",
        })

    owned = set(content.owned_ids(user)) if user is not None else set()
    _require_available_story(resume["scene"], owned)
    await _verify_request_connected(request)
    try:
        data = await _generate_while_connected(request, stories.generate_beat(
            resume["scene"], payload.index, resume["level"], resume["context"], resume["lang"], kind,
        ))
        if data["level"] != resume["level"]:
            raise OllamaError("The requested story level was unavailable.")
    except OllamaError as exc:
        raise HTTPException(503, detail={
            "code": "story_beat_unavailable", "message": "This beat is temporarily unavailable. Try again.",
        }) from exc
    return ExerciseOut(**tokens.attach_review_token(data, *identity))


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


@app.post("/review/exercise-token", response_model=ReviewExerciseTokenOut, dependencies=[Depends(check_rate_limit)])
async def renew_review_exercise(
    payload: ReviewExerciseTokenIn,
    user: Optional[User] = Depends(get_current_user_optional),
    request: Request = None,
) -> ReviewExerciseTokenOut:
    try:
        review_token = tokens.renew_review_token(payload.token, *_review_identity(user, request))
    except tokens.ReviewScopeError as exc:
        raise HTTPException(403, detail=str(exc)) from exc
    except tokens.TokenError as exc:
        raise HTTPException(400, detail={
            "code": "review_unrecoverable", "message": "This review item cannot be renewed.",
        }) from exc
    return ReviewExerciseTokenOut(review_token=review_token)


@app.post("/check", response_model=CheckOut, dependencies=[Depends(check_rate_limit)])
async def check(
    payload: CheckIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
) -> CheckOut:
    """Deterministic grade for interactive types. No LLM — instant and reliable.

    Economy: a correct answer earns koku for authenticated callers (server-authoritative —
    the wallet can only grow here, never via the client). Anonymous callers grade as before."""
    sealed, study_review = _check_token(payload.token, user, request)
    if "_chapter_review_owner" in sealed:
        return chapters.check_review(user, sealed, payload.response)
    if "_chapter" in sealed:
        return await chapters.check(user, db, sealed, payload.token, payload.response)
    evidence = await dojo.validate_grade(user, db, sealed, payload.token)
    recorded = await dojo.get_recorded_grade(user, db, evidence)
    if sealed.get("t") == "listen-and-retell":
        raise HTTPException(400, detail="Use the retelling check for this exercise.")
    if sealed.get("t") == "dojo-free-text":
        if recorded is not None:
            return CheckOut(**recorded)
        if request is not None:
            await llm_rate_limit(request)
        if not isinstance(payload.response, str) or not payload.response.strip() or len(payload.response) > 1000:
            raise HTTPException(422, detail="Enter a short text answer.")
        prof = await learner_profile.get_data(user, db)
        try:
            result = await grammar.check_answer(sealed["text"], payload.response, sealed.get("lang"),
                tone=prof.tone if prof else None, weak_spots=prof.weakSpots if prof else None)
        except OllamaError as exc:
            raise HTTPException(503, detail=str(exc)) from exc
        result, _ = await dojo.record_grade(user, db, evidence, {
            **result, "score": float(bool(result.get("correct"))),
        }, persist_feedback=False)
        return CheckOut(**result)
    result = recorded if recorded is not None else grammar.grade(sealed, payload.response)
    if study_review:
        return CheckOut(**result)
    first_result = False
    if recorded is None:
        result, first_result = await dojo.record_grade(
            user, db, evidence, result, reset_combo=True,
            miss=(sealed.get("topic"), sealed.get("text") or sealed.get("sentence")),
        )
    coins_earned, coins, first_win_bonus, combo_bonus = 0, None, 0, 0
    if result.get("correct"):
        # One-time-use: key the koku award on the token's hash so resubmitting the same correct
        # token can't farm coins (anti-replay; see wallet.award_correct_check).
        jti = sealed.get("_dojo_reward_jti") if sealed.get("_dojo_review_owner") else hashlib.sha256(payload.token.encode()).hexdigest()
        source_item = sealed.get("_dojo_reward_item") if sealed.get("_dojo_review_owner") else (sealed.get("_dojo") or {}).get("item")
        coins_earned, coins, first_win_bonus, combo_bonus = await wallet_service.award_correct_check(
            user, db, jti=jti, **({"durable_item_id": uuid.UUID(source_item)} if source_item else {})
        )
    elif first_result and evidence is None:
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


@app.post("/check-retell", response_model=CheckTextOut, dependencies=[Depends(llm_rate_limit)])
async def check_retell(
    payload: CheckRetellIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
) -> CheckTextOut:
    """LLM grade of a listen-and-retell answer: content coverage, not grammar (the rubric lives in
    grammar.check_retell). The passage comes out of the exercise's sealed token, so this endpoint
    only ever grades passages our generator spoke — it can't be driven as a free-form LLM proxy.
    `correct_answer` is the original passage: the reveal after answering IS the learning payoff.
    No koku here (mirrors /check-answer): an LLM verdict must not mint coins."""
    sealed, study_review = _check_token(payload.token, user, request)
    if sealed.get("t") != "listen-and-retell" or not sealed.get("passage"):
        raise HTTPException(status_code=400, detail="Not a listen-and-retell token.")
    evidence = await dojo.validate_grade(user, db, sealed, payload.token)
    recorded = await dojo.get_recorded_grade(user, db, evidence)
    if recorded is not None:
        return CheckTextOut(**{**recorded, "correct_answer": sealed["passage"]})
    prof = await learner_profile.get_data(user, db)
    try:
        data = await grammar.check_retell(
            str(sealed["passage"]),
            payload.retell,
            payload.lang,
            tone=prof.tone if prof else None,
            weak_spots=prof.weakSpots if prof else None,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if study_review:
        return CheckTextOut(**data)
    result, first_result = await dojo.record_grade(
        user, db, evidence, data, persist_feedback=False, miss=(sealed.get("topic"), sealed.get("passage")),
    )
    if first_result and evidence is None and not result.get("correct"):
        # Same weak-spot memory as /check: a missed retelling is a listening miss on this topic.
        await miss_log.record_miss(db, user, sealed.get("topic"), sealed.get("passage"))
    return CheckTextOut(**{**result, "correct_answer": sealed["passage"]})


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
        fallback = grammar.explanation_context_fallback(payload.text, payload.lang)
        if fallback is not None:
            yield " ".join((fallback["explanation"], fallback["tip"]))
            return
        try:
            async for chunk in llm_generate_stream(prompt, temperature=0.2, tier="smart"):
                yield chunk
        except OllamaError as exc:
            # The response is already 200/streaming, so surface the failure inline as text.
            yield f"\n[unavailable: {exc}]"

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


@app.post("/translate", response_model=TranslateOut, dependencies=[Depends(llm_rate_limit)])
async def translate(payload: TranslateIn) -> TranslateOut:
    """Tap-to-translate: one English word/phrase from an exercise → its meaning in the learner's UI
    language. `context` (the surrounding sentence) picks the right sense; no auth needed (it reads
    nothing about the learner), but it shares the LLM rate limit like every other model-backed route."""
    try:
        data = await grammar.translate(payload.text, payload.context, payload.lang)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return TranslateOut(**data)


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
