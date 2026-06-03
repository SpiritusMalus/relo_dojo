"""Grammar Dojo backend — Phase 1.

- GET  /health -> {"status": "ok"}
- POST /chat   -> sends the message to Ollama and returns the model's reply.

The Phase 0 mock (/echo) has been removed now that a real model backs the chat.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import ChatIn, ChatOut
from .services.ollama_client import OllamaError, generate

app = FastAPI(title="Grammar Dojo API", version="0.1.0")

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
        # 503: backend is up but Ollama isn't ready (not running / model missing).
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ChatOut(reply=reply)
