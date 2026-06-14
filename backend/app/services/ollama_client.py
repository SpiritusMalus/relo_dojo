"""Thin async wrapper over the Ollama HTTP API.

Talks to a self-hosted Ollama instance (handoff: prod LLM = Ollama only, never cloud).
Swapping the model = changing OLLAMA_MODEL in .env, app untouched.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from ..core.config import OLLAMA_MODEL, OLLAMA_URL


class OllamaError(Exception):
    """Raised for user-actionable Ollama problems (not running, model missing, bad output)."""


def parse_ollama_stream_line(line: str) -> str:
    """Extract the text delta from one NDJSON line of Ollama's streaming /api/generate response.

    Each line is a JSON object like {"response": "tok", "done": false}. Returns the `response`
    fragment ("" for blank lines, the terminal done frame, or anything unparseable). Pure — the
    stream-aggregation logic is unit-tested without a network."""
    line = line.strip()
    if not line:
        return ""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return ""
    if not isinstance(obj, dict):
        return ""
    return str(obj.get("response") or "")


async def generate(
    prompt: str, *, fmt: dict[str, Any] | str | None = None, temperature: float | None = None
) -> str:
    """Send a prompt to Ollama and return the model's reply text.

    `fmt` may be a JSON schema dict (or the string "json") to force structured output —
    essential for small models to return parseable JSON reliably.
    `temperature` (when set) controls randomness: lower = more deterministic.
    """
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict[str, Any] = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    if fmt is not None:
        payload["format"] = fmt
    if temperature is not None:
        payload["options"] = {"temperature": temperature}
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


async def generate_stream(
    prompt: str, *, temperature: float | None = None
) -> AsyncIterator[str]:
    """Stream the model's reply token-by-token (Ollama stream=true → NDJSON frames).

    Yields text deltas as they arrive (for perceived speed). Raises OllamaError on the same
    connectivity/404 conditions as `generate`."""
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict[str, Any] = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": True}
    if temperature is not None:
        payload["options"] = {"temperature": temperature}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code == 404:
                    raise OllamaError(
                        f"Model '{OLLAMA_MODEL}' not found. Pull it first: `ollama pull {OLLAMA_MODEL}`."
                    )
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    chunk = parse_ollama_stream_line(line)
                    if chunk:
                        yield chunk
    except httpx.ConnectError as exc:
        raise OllamaError(
            f"Cannot reach Ollama at {OLLAMA_URL}. Is it running? Try `ollama serve`."
        ) from exc
    except httpx.TimeoutException as exc:
        raise OllamaError("Ollama timed out — the model is taking too long to respond.") from exc


async def generate_json(
    prompt: str, schema: dict[str, Any], *, temperature: float | None = None
) -> dict[str, Any]:
    """Generate JSON constrained to `schema` and parse it. Raises OllamaError on bad JSON."""
    raw = await generate(prompt, fmt=schema, temperature=temperature)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OllamaError(f"Model returned invalid JSON: {raw[:200]}") from exc
