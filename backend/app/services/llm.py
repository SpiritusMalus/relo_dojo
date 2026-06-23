"""LLM provider abstraction (API migration, decided 2026-06-11).

One `generate` / `generate_json` surface, routed by LLM_PROVIDER:
- "ollama" (default) — self-hosted Ollama; the local-dev path, behavior unchanged.
- "anthropic" — Claude via the Messages API; structured output via a forced tool call
  (the schema becomes the tool's input_schema, so the reply IS the parsed JSON).
- "openai" — Chat Completions; structured output via response_format json_schema.
- "gemini" — Google generateContent; structured output via generationConfig.responseSchema
  (an OpenAPI subset), with a responseMimeType=application/json + json.loads fallback.

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
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
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


# Keys Gemini's responseSchema (an OpenAPI 3.0 subset) accepts; everything else is stripped.
_GEMINI_SCHEMA_KEYS = {"type", "properties", "items", "required", "enum", "description", "nullable"}


def to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any] | None:
    """Translate one of our JSON-Schema objects to Gemini's responseSchema subset.

    Keeps only the supported keys, recursing into properties/items. Returns None if the result
    is empty (e.g. nothing mapped) — the caller then drops responseSchema and relies on the
    responseMimeType=application/json + json.loads fallback, mirroring the OpenAI path."""
    if not isinstance(schema, dict):
        return None
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in _GEMINI_SCHEMA_KEYS:
            continue
        if key == "properties" and isinstance(value, dict):
            mapped_props = {k: to_gemini_schema(v) for k, v in value.items()}
            out["properties"] = {k: v for k, v in mapped_props.items() if v is not None}
        elif key == "items":
            mapped_items = to_gemini_schema(value)
            if mapped_items is not None:
                out["items"] = mapped_items
        else:
            out[key] = value
    return out or None


def build_gemini_payload(
    prompt: str, schema: dict[str, Any] | None = None, temperature: float | None = None
) -> dict[str, Any]:
    gen_config: dict[str, Any] = {"maxOutputTokens": settings.LLM_MAX_TOKENS}
    if temperature is not None:
        gen_config["temperature"] = temperature
    if schema is not None:
        # JSON mime is the safety net; responseSchema is added when the schema maps cleanly.
        gen_config["responseMimeType"] = "application/json"
        mapped = to_gemini_schema(schema)
        if mapped is not None:
            gen_config["responseSchema"] = mapped
    return {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gen_config}


def parse_gemini_response(data: dict[str, Any], expect_json: bool) -> Any:
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(str(p.get("text") or "") for p in parts)
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Gemini returned no usable content.") from exc
    if not text.strip():
        raise LLMError("Gemini returned no usable content.")
    if not expect_json:
        return text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model returned invalid JSON: {text[:200]}") from exc


# --- streaming line parsers (SSE; unit-tested offline, mirror the Ollama NDJSON parser) ----------
def parse_anthropic_sse_line(line: str) -> str:
    """Text delta from one Anthropic Messages-stream SSE line, or "" for any non-text/control line.
    Anthropic emits `data: {...}` frames; only `content_block_delta` with a `text_delta` carries text."""
    line = line.strip()
    if not line.startswith("data:"):
        return ""
    raw = line[len("data:"):].strip()
    if not raw or raw == "[DONE]":
        return ""
    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    if isinstance(evt, dict) and evt.get("type") == "content_block_delta":
        delta = evt.get("delta") or {}
        if isinstance(delta, dict) and delta.get("type") == "text_delta":
            return str(delta.get("text") or "")
    return ""


def parse_openai_sse_line(line: str) -> str:
    """Text delta from one OpenAI Chat-Completions-stream SSE line, or "" for control/[DONE] lines."""
    line = line.strip()
    if not line.startswith("data:"):
        return ""
    raw = line[len("data:"):].strip()
    if not raw or raw == "[DONE]":
        return ""
    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    try:
        return str(evt["choices"][0]["delta"].get("content") or "")
    except (KeyError, IndexError, TypeError):
        return ""


def parse_gemini_sse_line(line: str) -> str:
    """Text delta from one Gemini streamGenerateContent?alt=sse line, or "" for control lines.
    Gemini emits `data: {...}` frames; each carries candidates[0].content.parts[*].text."""
    line = line.strip()
    if not line.startswith("data:"):
        return ""
    raw = line[len("data:"):].strip()
    if not raw or raw == "[DONE]":
        return ""
    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    try:
        parts = evt["candidates"][0]["content"]["parts"]
        return "".join(str(p.get("text") or "") for p in parts)
    except (KeyError, IndexError, TypeError):
        return ""


# --- transport ----------------------------------------------------------------
def _raise_for_status(status: int, name: str, text: str = "") -> None:
    if status in (401, 403):
        raise LLMError(f"{name} API key missing or rejected — check the key in .env.")
    if status == 429:
        raise LLMError(f"{name} rate limit hit — try again shortly.")
    if status >= 400:
        raise LLMError(f"{name} API error {status}: {text[:200]}")


async def _post(url: str, headers: dict[str, str], payload: dict[str, Any], name: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.ConnectError as exc:
        raise LLMError(f"Cannot reach the {name} API — check the network.") from exc
    except httpx.TimeoutException as exc:
        raise LLMError(f"The {name} API timed out.") from exc
    _raise_for_status(resp.status_code, name, resp.text)
    return resp.json()


async def _stream_lines(
    url: str, headers: dict[str, str], payload: dict[str, Any], name: str
) -> AsyncIterator[str]:
    """POST and yield raw SSE lines, with the same LLMError mapping as _post."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    _raise_for_status(resp.status_code, name, body)
                async for line in resp.aiter_lines():
                    yield line
    except httpx.ConnectError as exc:
        raise LLMError(f"Cannot reach the {name} API — check the network.") from exc
    except httpx.TimeoutException as exc:
        raise LLMError(f"The {name} API timed out.") from exc


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


async def _gemini(prompt: str, schema: dict[str, Any] | None, temperature: float | None) -> Any:
    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    headers = {"x-goog-api-key": key}
    url = f"{GEMINI_BASE}/models/{settings.GEMINI_MODEL}:generateContent"
    data = await _post(url, headers, build_gemini_payload(prompt, schema, temperature), "Gemini")
    return parse_gemini_response(data, expect_json=schema is not None)


async def _anthropic_stream(prompt: str, temperature: float | None) -> AsyncIterator[str]:
    headers = {
        "x-api-key": _require_key(settings.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", "anthropic"),
        "anthropic-version": ANTHROPIC_VERSION,
    }
    payload = build_anthropic_payload(prompt, None, temperature)
    payload["stream"] = True
    async for line in _stream_lines(ANTHROPIC_URL, headers, payload, "Anthropic"):
        delta = parse_anthropic_sse_line(line)
        if delta:
            yield delta


async def _openai_stream(prompt: str, temperature: float | None) -> AsyncIterator[str]:
    headers = {
        "Authorization": f"Bearer {_require_key(settings.OPENAI_API_KEY, 'OPENAI_API_KEY', 'openai')}"
    }
    payload = build_openai_payload(prompt, None, temperature)
    payload["stream"] = True
    async for line in _stream_lines(OPENAI_URL, headers, payload, "OpenAI"):
        delta = parse_openai_sse_line(line)
        if delta:
            yield delta


async def _gemini_stream(prompt: str, temperature: float | None) -> AsyncIterator[str]:
    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    headers = {"x-goog-api-key": key}
    url = f"{GEMINI_BASE}/models/{settings.GEMINI_MODEL}:streamGenerateContent?alt=sse"
    payload = build_gemini_payload(prompt, None, temperature)
    async for line in _stream_lines(url, headers, payload, "Gemini"):
        delta = parse_gemini_sse_line(line)
        if delta:
            yield delta


# --- public surface (same signatures the app used with ollama_client) ---------
async def generate(prompt: str, *, temperature: float | None = None) -> str:
    p = _provider()
    if p == "anthropic":
        return await _anthropic(prompt, None, temperature)
    if p == "openai":
        return await _openai(prompt, None, temperature)
    if p == "gemini":
        return await _gemini(prompt, None, temperature)
    return await _ollama_generate(prompt, temperature=temperature)


async def generate_json(
    prompt: str, schema: dict[str, Any], *, temperature: float | None = None
) -> dict[str, Any]:
    p = _provider()
    if p == "anthropic":
        return await _anthropic(prompt, schema, temperature)
    if p == "openai":
        return await _openai(prompt, schema, temperature)
    if p == "gemini":
        return await _gemini(prompt, schema, temperature)
    return await _ollama_generate_json(prompt, schema, temperature=temperature)


async def generate_stream(prompt: str, *, temperature: float | None = None) -> AsyncIterator[str]:
    """Stream a free-text reply as deltas, routed by provider.

    All providers stream incrementally: Ollama via NDJSON, Anthropic via the Messages stream,
    OpenAI via Chat-Completions SSE, Gemini via streamGenerateContent SSE. Each yields text deltas
    (control frames filtered out). Same LLMError contract as the non-streaming surface."""
    p = _provider()
    if p == "anthropic":
        async for delta in _anthropic_stream(prompt, temperature):
            yield delta
        return
    if p == "openai":
        async for delta in _openai_stream(prompt, temperature):
            yield delta
        return
    if p == "gemini":
        async for delta in _gemini_stream(prompt, temperature):
            yield delta
        return
    async for chunk in _ollama_generate_stream(prompt, temperature=temperature):
        yield chunk


def active_model() -> str:
    """The model the current provider will use (for logs / eval reports)."""
    p = _provider()
    if p == "anthropic":
        return settings.ANTHROPIC_MODEL
    if p == "openai":
        return settings.OPENAI_MODEL
    if p == "gemini":
        return settings.GEMINI_MODEL
    return settings.OLLAMA_MODEL
