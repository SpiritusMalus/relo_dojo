"""Grammar Dojo backend — Phase 2.

- GET  /health       -> {"status": "ok"}
- POST /chat         -> free chat with the model (Phase 1)
- POST /exercise     -> generate a grammar exercise (Phase 2)
- POST /check-answer -> check the learner's answer + explain (Phase 2)

The LLM is self-hosted Ollama; the model is set via OLLAMA_MODEL in .env.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import ChatIn, ChatOut, CheckIn, CheckOut, ExerciseOut
from .services import grammar
from .services.ollama_client import OllamaError, generate

app = FastAPI(title="Grammar Dojo API", version="0.2.0")

# Expo dev client calls from a different origin; allow all during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
async def exercise() -> ExerciseOut:
    try:
        data = await grammar.generate_exercise()
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # grammar guarantees keys; the correct answer stays server-side (not in ExerciseOut).
    return ExerciseOut(**data)


@app.post("/check-answer", response_model=CheckOut)
async def check_answer(payload: CheckIn) -> CheckOut:
    try:
        data = await grammar.check_answer(
            payload.type, payload.text, payload.options, payload.user_answer
        )
    except OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return CheckOut(**data)
