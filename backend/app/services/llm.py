"""LLM provider abstraction (API migration, decided 2026-06-11).

One `generate` / `generate_json` surface, routed by LLM_PROVIDER:
- "ollama" (default) — self-hosted Ollama; the local-dev path, behavior unchanged.
- "anthropic" — Claude via the Messages API; structured output via a forced tool call
  (the schema becomes the tool's input_schema, so the reply IS the parsed JSON).
- "openai" — Chat Completions; structured output via response_format json_schema.

Every provider raises the SAME exception (`LLMError`, aliased to the historical `OllamaError`)
so the 503 handling in main.py works for all of them unchanged.

NOTE: prompts are not model-agnostic. Before flipping LLM_PROVIDER in prod, re-run the 53-item
eval set against the target model (`python -m evals.run_eval --provider anthropic ...`).
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from ..core.config import settings
from .ollama_client import OllamaError
from .ollama_client import generate as _ollama_generate
from .ollama_client import generate_json as _ollama_generate_json
from .ollama_client import generate_stream as _ollama_generate_stream

# One exception type across providers; old name kept so existing imports/handlers still work.
LLMError = OllamaError

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
TIMEOUT = 120.0


def _provider() -> str:
    return (settings.LLM_PROVIDER or "ollama").strip().lower()


# --- pure payload builders / response parsers (unit-tested offline) -----------
def build_anthropic_payload(
    prompt: str, schema: dict[str, Any] | None = None, temperature: float | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": settings.LLM_MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}],
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if schema is not None:
        # Forced tool use = guaranteed structured output: the model must "call" emit(<schema>).
        payload["tools"] = [
            {"name": "emit", "description": "Return the answer as structured data.", "input_schema": schema}
        ]
        payload["tool_choice"] = {"type": "tool", "name": "emit"}
    return payload


def parse_anthropic_response(data: dict[str, Any], expect_json: bool) -> Any:
    for block in data.get("content") or []:
        if expect_json and block.get("type") == "tool_use":
            inp = block.get("input")
            if isinstance(inp, dict):
                return inp
        if not expect_json and block.get("type") == "text":
            return str(block.get("text") or "").strip()
    raise LLMError("Anthropic returned no usable content.")


def build_openai_payload(
    prompt: str, schema: dict[str, Any] | None = None, temperature: float | None = None
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.OPENAI_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": settings.LLM_MAX_TOKENS,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if schema is not None:
        # strict=False: our schemas don't carry additionalProperties=false on purpose
        # (strict mode would reject them); loose json_schema adherence is enough here.
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "out", "schema": schema, "strict": False},
        }
    return payload


def parse_openai_response(data: dict[str, Any], expect_json: bool) -> Any:
    try:
        content = str(data["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("OpenAI returned no usable content.") from exc
    if not expect_json:
        return content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model returned invalid JSON: {content[:200]}") from exc


# --- transport ----------------------------------------------------------------
async def _post(url: str, headers: dict[str, str], payload: dict[str, Any], name: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.ConnectError as exc:
        raise LLMError(f"Cannot reach the {name} API — check the network.") from exc
    except httpx.TimeoutException as exc:
        raise LLMError(f"The {name} API timed out.") from exc
    if resp.status_code in (401, 403):
        raise LLMError(f"{name} API key missing or rejected — check the key in .env.")
    if resp.status_code == 429:
        raise LLMError(f"{name} rate limit hit — try again shortly.")
    if resp.status_code >= 400:
        raise LLMError(f"{name} API error {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def _require_key(key: str, env_name: str, provider: str) -> str:
    if not key:
        raise LLMError(f"LLM_PROVIDER={provider} but {env_name} is not set in .env.")
    return key


async def _anthropic(prompt: str, schema: dict[str, Any] | None, temperature: float | None) -> Any:
    headers = {
        "x-api-key": _require_key(settings.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", "anthropic"),
        "anthropic-version": ANTHROPIC_VERSION,
    }
    data = await _post(ANTHROPIC_URL, headers, build_anthropic_payload(prompt, schema, temperature), "Anthropic")
    return parse_anthropic_response(data, expect_json=schema is not None)


async def _openai(prompt: str, schema: dict[str, Any] | None, temperature: float | None) -> Any:
    headers = {
        "Authorization": f"Bearer {_require_key(settings.OPENAI_API_KEY, 'OPENAI_API_KEY', 'openai')}"
    }
    data = await _post(OPENAI_URL, headers, build_openai_payload(prompt, schema, temperature), "OpenAI")
    return parse_openai_response(data, expect_json=schema is not None)


# --- public surface (same signatures the app used with ollama_client) ---------
async def generate(prompt: str, *, temperature: float | None = None) -> str:
    p = _provider()
    if p == "anthropic":
        return await _anthropic(prompt, None, temperature)
    if p == "openai":
        return await _openai(prompt, None, temperature)
    return await _ollama_generate(prompt, temperature=temperature)


async def generate_json(
    prompt: str, schema: dict[str, Any], *, temperature: float | None = None
) -> dict[str, Any]:
    p = _provider()
    if p == "anthropic":
        return await _anthropic(prompt, schema, temperature)
    if p == "openai":
        return await _openai(prompt, schema, temperature)
    return await _ollama_generate_json(prompt, schema, temperature=temperature)


async def generate_stream(prompt: str, *, temperature: float | None = None) -> AsyncIterator[str]:
    """Stream a free-text reply as deltas, routed by provider.

    Ollama streams natively (token-by-token). The API providers don't have incremental SSE wired
    here yet, so they fall back to a single full-reply chunk — the endpoint surface still works on
    every provider; richer SSE for Anthropic/OpenAI is a follow-up. Same LLMError contract."""
    p = _provider()
    if p == "ollama":
        async for chunk in _ollama_generate_stream(prompt, temperature=temperature):
            yield chunk
        return
    yield await generate(prompt, temperature=temperature)


def active_model() -> str:
    """The model the current provider will use (for logs / eval reports)."""
    p = _provider()
    if p == "anthropic":
        return settings.ANTHROPIC_MODEL
    if p == "openai":
        return settings.OPENAI_MODEL
    return settings.OLLAMA_MODEL
