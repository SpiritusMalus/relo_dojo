"""Grammar Dojo backend — Phase 0.

Minimal FastAPI service to prove phone <-> backend connectivity.
- GET  /health  -> {"status": "ok"}
- POST /echo    -> returns the text it was sent (Phase 0 mock; removed in Phase 1 when Ollama lands)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import EchoIn, EchoOut

app = FastAPI(title="Grammar Dojo API", version="0.0.0")

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


@app.post("/echo", response_model=EchoOut)
def echo(payload: EchoIn) -> EchoOut:
    return EchoOut(text=payload.text)
