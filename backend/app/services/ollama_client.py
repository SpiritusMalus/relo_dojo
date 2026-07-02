"""Thin async wrapper over the Ollama HTTP API.

Talks to a self-hosted Ollama instance (handoff: prod LLM = Ollama only, never cloud).
Swapping the model = changing OLLAMA_MODEL in .env, app untouched.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, AsyncIterator

import httpx

from ..core.config import OLLAMA_MODEL, OLLAMA_URL
from . import http_client

logger = logging.getLogger(__name__)


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
    prompt: str,
    *,
    fmt: dict[str, Any] | str | None = None,
    temperature: float | None = None,
    model: str | None = None,
) -> str:
    """Send a prompt to Ollama and return the model's reply text.

    `fmt` may be a JSON schema dict (or the string "json") to force structured output —
    essential for small models to return parseable JSON reliably.
    `temperature` (when set) controls randomness: lower = more deterministic.
    `model` overrides OLLAMA_MODEL (the smart-tier slot in services.llm routes through this).
    """
    m = model or OLLAMA_MODEL
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict[str, Any] = {"model": m, "prompt": prompt, "stream": False}
    if fmt is not None:
        payload["format"] = fmt
    if temperature is not None:
        payload["options"] = {"temperature": temperature}
    started = time.monotonic()
    resp = None
    for attempt in (1, 2):
        try:
            resp = await http_client.client().post(url, json=payload)
            break
        except httpx.RemoteProtocolError as exc:
            # The pooled client picked up a keep-alive connection Ollama had already closed
            # ("server disconnected") — the request never ran; one retry on a fresh connection.
            if attempt == 2:
                raise OllamaError("Ollama dropped the connection — try again.") from exc
            logger.warning("llm retry name=Ollama model=%s attempt=%d cause=RemoteProtocolError", m, attempt)
        except httpx.ConnectError as exc:
            raise OllamaError(
                f"Cannot reach Ollama at {OLLAMA_URL}. Is it running? Try `ollama serve`."
            ) from exc
        except httpx.TimeoutException as exc:
            raise OllamaError("Ollama timed out — the model is taking too long to respond.") from exc

    if resp.status_code == 404:
        raise OllamaError(f"Model '{m}' not found. Pull it first: `ollama pull {m}`.")
    resp.raise_for_status()

    data = resp.json()
    # Same telemetry line as the API providers (services.llm) so dev logs read identically.
    logger.info(
        "llm ok name=Ollama model=%s ms=%d attempts=1 tok_in=%s tok_out=%s",
        m,
        int((time.monotonic() - started) * 1000),
        data.get("prompt_eval_count"),
        data.get("eval_count"),
    )
    return str(data.get("response", "")).strip()


async def generate_stream(
    prompt: str, *, temperature: float | None = None, model: str | None = None
) -> AsyncIterator[str]:
    """Stream the model's reply token-by-token (Ollama stream=true → NDJSON frames).

    Yields text deltas as they arrive (for perceived speed). Raises OllamaError on the same
    connectivity/404 conditions as `generate`."""
    m = model or OLLAMA_MODEL
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict[str, Any] = {"model": m, "prompt": prompt, "stream": True}
    if temperature is not None:
        payload["options"] = {"temperature": temperature}
    try:
        async with http_client.client().stream("POST", url, json=payload) as resp:
            if resp.status_code == 404:
                raise OllamaError(f"Model '{m}' not found. Pull it first: `ollama pull {m}`.")
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
    prompt: str, schema: dict[str, Any], *, temperature: float | None = None, model: str | None = None
) -> dict[str, Any]:
    """Generate JSON constrained to `schema` and parse it. Raises OllamaError on bad JSON.

    One retry on a parse failure: even with format-constrained decoding the model occasionally
    truncates mid-string (live eval: 3/53 checks), and sampling makes that transient — a fresh
    generation usually parses. A second failure raises as before."""
    for attempt in (1, 2):
        raw = await generate(prompt, fmt=schema, temperature=temperature, model=model)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            if attempt == 2:
                raise OllamaError(f"Model returned invalid JSON: {raw[:200]}") from exc
            logger.warning(
                "llm retry name=Ollama model=%s attempt=%d cause=invalid-json",
                model or OLLAMA_MODEL,
                attempt,
            )
    raise OllamaError("unreachable")  # loop always returns or raises
