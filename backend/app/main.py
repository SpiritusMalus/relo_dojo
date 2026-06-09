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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .routers import auth as auth_router
from .routers import progress as progress_router
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
    StoryIn,
    StoryOut,
)
from .services import grammar, stories, tokens
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
app.include_router(progress_router.router)


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
async def exercise(payload: ExerciseIn = ExerciseIn()) -> ExerciseOut:
    """Optionally steered by the client (topic/level/type) for adaptive difficulty; public."""
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
async def story(payload: StoryIn = StoryIn()) -> StoryOut:
    """Generate a themed mini-story: a curated scenario wrapping a sequence of linked exercises.

    Each beat's answer stays sealed in its own `token` and is graded by the existing /check. Public.
    """
    try:
        data = await stories.build_story(level=payload.level, context_override=payload.context)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return StoryOut(**data)


@app.post("/check", response_model=CheckOut)
def check(payload: CheckIn) -> CheckOut:
    """Deterministic grade for interactive types. No LLM — instant and reliable."""
    try:
        sealed = tokens.unseal(payload.token)
    except tokens.TokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = grammar.grade(sealed, payload.response)
    return CheckOut(**result)


@app.post("/check-answer", response_model=CheckTextOut)
async def check_answer(payload: CheckTextIn) -> CheckTextOut:
    try:
        data = await grammar.check_answer(payload.text, payload.user_answer, payload.lang)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return CheckTextOut(**data)


@app.post("/explain", response_model=ExplainOut)
async def explain(payload: ExplainIn) -> ExplainOut:
    try:
        data = await grammar.explain(payload.text, payload.correct_answer, payload.user_response, payload.lang)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ExplainOut(**data)


@app.post("/profile/analyze", response_model=AnalyzeOut)
async def analyze(payload: AnalyzeIn) -> AnalyzeOut:
    """Onboarding: map a free-text 'what's hard for me' to canonical grammar topics. Public."""
    try:
        topics = await grammar.analyze_pain(payload.text)
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return AnalyzeOut(topics=topics)
