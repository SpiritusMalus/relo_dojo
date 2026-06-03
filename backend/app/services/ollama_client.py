"""Thin async wrapper over the Ollama HTTP API.

Talks to a self-hosted Ollama instance (handoff: prod LLM = Ollama only, never cloud).
Used by POST /chat. Swapping the model = changing OLLAMA_MODEL in .env, app untouched.
"""

import httpx

from ..core.config import OLLAMA_MODEL, OLLAMA_URL


class OllamaError(Exception):
    """Raised for user-actionable Ollama problems (not running, model missing)."""


async def generate(prompt: str) -> str:
    """Send a prompt to Ollama and return the model's reply text."""
    url = f"{OLLAMA_URL}/api/generate"
    payload = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
    except httpx.ConnectError as exc:
        raise OllamaError(
            f"Cannot reach Ollama at {OLLAMA_URL}. Is it running? Try `ollama serve`."
        ) from exc
    except httpx.TimeoutException as exc:
        raise OllamaError("Ollama timed out — the model is taking too long to respond.") from exc

    if resp.status_code == 404:
        raise OllamaError(
            f"Model '{OLLAMA_MODEL}' not found. Pull it first: `ollama pull {OLLAMA_MODEL}`."
        )
    resp.raise_for_status()

    data = resp.json()
    return str(data.get("response", "")).strip()
