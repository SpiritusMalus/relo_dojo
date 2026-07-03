"""LLM provider abstraction (API migration, decided 2026-06-11).

One `generate` / `generate_json` surface, routed by LLM_PROVIDER:
- "ollama" (default) — self-hosted Ollama; the local-dev path, behavior unchanged.
- "anthropic" — Claude via the Messages API; structured output via a forced tool call
  (the schema becomes the tool's input_schema, so the reply IS the parsed JSON).
- "openai" — Chat Completions; structured output via response_format json_schema.
- "openrouter" — OpenRouter's OpenAI-compatible Chat Completions (one sk-or key fronts many models;
  we keep the Gemini family). Reuses the OpenAI payload/parser, just a different base URL + key.
  NOTE: realtime voice (Gemini Live) is NOT reachable via OpenRouter — only the "gemini" provider.
- "gemini" — Google generateContent; structured output via generationConfig.responseSchema
  (an OpenAPI subset), with a responseMimeType=application/json + json.loads fallback.

Every provider raises the SAME exception (`LLMError`, aliased to the historical `OllamaError`)
so the 503 handling in main.py works for all of them unchanged.

NOTE: prompts are not model-agnostic. Before flipping LLM_PROVIDER in prod, re-run the 53-item
eval set against the target model (`python -m evals.run_eval --provider anthropic ...`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

import httpx

from ..core.config import settings
from . import http_client
from .ollama_client import OllamaError, OllamaTimeoutError
from .ollama_client import generate as _ollama_generate
from .ollama_client import generate_json as _ollama_generate_json
from .ollama_client import generate_stream as _ollama_generate_stream

# One exception type across providers; old name kept so existing imports/handlers still work.
LLMError = OllamaError
# Timeouts as a distinguishable subclass: callers with their own retry loops (generate_exercise)
# must NOT re-attempt these — each retry adds another full timeout window of user-facing wait.
LLMTimeoutError = OllamaTimeoutError

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = http_client.TIMEOUT  # kept as a public constant; the pooled client owns the value

# Transient-failure retry: blips that fail fast or clear quickly get LLM_RETRIES extra attempts
# with a short growing backoff — without this, a single 429/5xx/connect hiccup at the provider
# surfaces as a user-facing 503. RemoteProtocolError is in the set because the pooled client can
# pick up a keep-alive connection the server has meanwhile closed ("server disconnected") — the
# request never ran, so a retry on a fresh connection is safe. Read timeouts are deliberately NOT
# retried: the request already consumed the full 120s window, and a retry would double the wait.
LLM_RETRIES = 2
RETRY_BACKOFF_S = 0.5  # multiplied by the attempt number
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_CONNECT_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
    httpx.RemoteProtocolError,
)


def _provider() -> str:
    return (settings.LLM_PROVIDER or "ollama").strip().lower()


def _model_for(provider: str, tier: str) -> str:
    """The configured model for (provider, tier). tier="smart" reads the *_MODEL_SMART slot and
    falls back to the base slot when it's unset — enabling tiers is pure config, safe by default."""
    smart = tier == "smart"
    if provider == "anthropic":
        return (settings.ANTHROPIC_MODEL_SMART if smart else "") or settings.ANTHROPIC_MODEL
    if provider == "openai":
        return (settings.OPENAI_MODEL_SMART if smart else "") or settings.OPENAI_MODEL
    if provider == "openrouter":
        return (settings.OPENROUTER_MODEL_SMART if smart else "") or settings.OPENROUTER_MODEL
    if provider == "gemini":
        return (settings.GEMINI_MODEL_SMART if smart else "") or settings.GEMINI_MODEL
    return (settings.OLLAMA_MODEL_SMART if smart else "") or settings.OLLAMA_MODEL


# --- pure payload builders / response parsers (unit-tested offline) -----------
def build_anthropic_payload(
    prompt: str,
    schema: dict[str, Any] | None = None,
    temperature: float | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model or settings.ANTHROPIC_MODEL,
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
    prompt: str,
    schema: dict[str, Any] | None = None,
    temperature: float | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    # `model` lets the OpenAI-compatible OpenRouter path reuse this builder with its own slug.
    payload: dict[str, Any] = {
        "model": model or settings.OPENAI_MODEL,
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


def with_openrouter_prefs(payload: dict[str, Any]) -> dict[str, Any]:
    """Attach the configured OpenRouter-specific preferences to a payload (in place, returned for
    chaining): a reasoning-effort cap and an upstream routing sort. Both are opt-in .env knobs —
    empty settings leave the payload untouched, so rollback is deleting one .env line.
    OpenRouter-only: the OpenAI provider shares the payload builder but has its own semantics for
    these fields, so it never goes through here."""
    effort = (settings.OPENROUTER_REASONING_EFFORT or "").strip().lower()
    if effort:
        payload["reasoning"] = {"effort": effort}
    sort = (settings.OPENROUTER_PROVIDER_SORT or "").strip().lower()
    if sort:
        payload["provider"] = {"sort": sort}
    return payload


# Historical name (pre provider-sort); voice_transcribe and any out-of-tree callers keep working.
with_openrouter_reasoning = with_openrouter_prefs


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
def _error_reason(text: str, limit: int = 200) -> str:
    """The provider's own words for why a request failed, as one truncated line.

    All four providers wrap errors as JSON with a message field (OpenAI/OpenRouter/Gemini:
    `error.message`; Anthropic: `error.message` under type "error") — pull that out; fall back to
    the raw body. OpenRouter moderation/guardrail 403s also carry `error.metadata.reasons`, which
    is the ONLY place the flag cause is visible — keep it."""
    reason = (text or "").strip()
    try:
        err = json.loads(reason).get("error")
        if isinstance(err, dict):
            reason = str(err.get("message") or "").strip() or reason
            meta = err.get("metadata")
            if isinstance(meta, dict) and meta.get("reasons"):
                reason = f"{reason} (reasons: {meta['reasons']})"
    except (json.JSONDecodeError, AttributeError):
        pass
    return " ".join(reason.split())[:limit]


def _raise_for_status(status: int, name: str, text: str = "") -> None:
    # 401 and 403 are NOT the same failure: 401 is bad credentials, while 403 (on OpenRouter) is a
    # per-request refusal — content moderation/guardrail flag or key permissions. Telling the user
    # to "check the key" for a 403 sends them (and us) debugging the wrong thing.
    if status == 401:
        raise LLMError(f"{name} API key missing or rejected — check the key in .env.")
    if status == 402:
        raise LLMError(f"{name}: the account is out of credits — top up the provider balance.")
    if status == 403:
        reason = _error_reason(text) or "permissions or content guardrail"
        raise LLMError(f"{name} refused this request ({reason}).")
    if status == 429:
        raise LLMError(f"{name} rate limit hit — try again shortly.")
    if status >= 400:
        raise LLMError(f"{name} API error {status}: {_error_reason(text)}")


def _usage_from(data: dict[str, Any]) -> tuple[Any, Any, Any]:
    """(input, output, reasoning) token counts from a provider response, best-effort — None for
    anything the provider didn't send. Shapes: OpenAI/OpenRouter `usage.{prompt,completion}_tokens`
    (+ `completion_tokens_details.reasoning_tokens`), Anthropic `usage.{input,output}_tokens` (no
    reasoning split), Gemini `usageMetadata.{promptTokenCount,candidatesTokenCount,
    thoughtsTokenCount}`. The reasoning count is prod-critical visibility: "47 output tokens in 8s"
    is inexplicable until the log shows the hidden thinking tokens billed at 6x alongside it."""
    u = data.get("usage")
    if isinstance(u, dict):
        det = u.get("completion_tokens_details")
        return (
            u.get("prompt_tokens", u.get("input_tokens")),
            u.get("completion_tokens", u.get("output_tokens")),
            det.get("reasoning_tokens") if isinstance(det, dict) else None,
        )
    u = data.get("usageMetadata")
    if isinstance(u, dict):
        return (u.get("promptTokenCount"), u.get("candidatesTokenCount"), u.get("thoughtsTokenCount"))
    return (None, None, None)


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


async def _post(
    url: str, headers: dict[str, str], payload: dict[str, Any], name: str, model: str = ""
) -> dict[str, Any]:
    """POST with transient-failure retry and one telemetry line per call (the only place cost and
    latency are visible in prod). `model` defaults from the payload; Gemini passes it explicitly
    (its model rides in the URL)."""
    model = model or str(payload.get("model") or "")
    started = time.monotonic()
    last_status = 0
    last_text = ""
    for attempt in range(1, LLM_RETRIES + 2):
        try:
            resp = await http_client.client().post(url, json=payload, headers=headers)
        except _CONNECT_ERRORS as exc:
            if attempt <= LLM_RETRIES:
                logger.warning("llm retry name=%s model=%s attempt=%d cause=%s", name, model, attempt, type(exc).__name__)
                await asyncio.sleep(RETRY_BACKOFF_S * attempt)
                continue
            raise LLMError(f"Cannot reach the {name} API — check the network.") from exc
        except httpx.TimeoutException as exc:
            logger.warning("llm error name=%s model=%s ms=%d cause=timeout", name, model, _ms(started))
            raise LLMTimeoutError(f"The {name} API timed out.") from exc
        last_status, last_text = resp.status_code, resp.text
        if resp.status_code in RETRYABLE_STATUS and attempt <= LLM_RETRIES:
            logger.warning("llm retry name=%s model=%s attempt=%d status=%d", name, model, attempt, resp.status_code)
            await asyncio.sleep(RETRY_BACKOFF_S * attempt)
            continue
        try:
            _raise_for_status(resp.status_code, name, resp.text)
        except LLMError:
            # The body is the only place the provider says WHY (moderation reason, key limit,
            # credit state) — without it a prod 403 is undebuggable from journald.
            logger.warning(
                "llm error name=%s model=%s ms=%d status=%d body=%s",
                name, model, _ms(started), resp.status_code, _error_reason(resp.text),
            )
            raise
        data = resp.json()
        tok_in, tok_out, tok_think = _usage_from(data)
        logger.info(
            "llm ok name=%s model=%s ms=%d attempts=%d tok_in=%s tok_out=%s tok_think=%s provider=%s",
            name, model, _ms(started), attempt, tok_in, tok_out, tok_think,
            data.get("provider"),  # which upstream OpenRouter routed to — the slow-tail suspect
        )
        return data
    # Retries exhausted on a retryable status (the loop never got past the continue).
    logger.warning(
        "llm error name=%s model=%s ms=%d status=%d retries=exhausted body=%s",
        name, model, _ms(started), last_status, _error_reason(last_text),
    )
    _raise_for_status(last_status, name, last_text)
    raise LLMError(f"{name} API error {last_status}.")  # pragma: no cover — _raise_for_status raised


async def _stream_lines(
    url: str, headers: dict[str, str], payload: dict[str, Any], name: str, model: str = ""
) -> AsyncIterator[str]:
    """POST and yield raw SSE lines, with the same LLMError mapping and retry policy as _post —
    but only failures BEFORE the first byte are retried; a broken mid-stream is surfaced (the
    caller already forwarded partial output)."""
    model = model or str(payload.get("model") or "")
    started = time.monotonic()
    for attempt in range(1, LLM_RETRIES + 2):
        yielded = False
        try:
            async with http_client.client().stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    if resp.status_code in RETRYABLE_STATUS and attempt <= LLM_RETRIES:
                        logger.warning("llm retry name=%s model=%s attempt=%d status=%d", name, model, attempt, resp.status_code)
                        await asyncio.sleep(RETRY_BACKOFF_S * attempt)
                        continue
                    logger.warning(
                        "llm error name=%s model=%s ms=%d status=%d body=%s",
                        name, model, _ms(started), resp.status_code, _error_reason(body),
                    )
                    _raise_for_status(resp.status_code, name, body)
                async for line in resp.aiter_lines():
                    yielded = True
                    yield line
            logger.info("llm ok name=%s model=%s ms=%d attempts=%d stream=1", name, model, _ms(started), attempt)
            return
        except _CONNECT_ERRORS as exc:
            if not yielded and attempt <= LLM_RETRIES:
                logger.warning("llm retry name=%s model=%s attempt=%d cause=%s", name, model, attempt, type(exc).__name__)
                await asyncio.sleep(RETRY_BACKOFF_S * attempt)
                continue
            raise LLMError(f"Cannot reach the {name} API — check the network.") from exc
        except httpx.TimeoutException as exc:
            logger.warning("llm error name=%s model=%s ms=%d cause=timeout stream=1", name, model, _ms(started))
            raise LLMTimeoutError(f"The {name} API timed out.") from exc


def _require_key(key: str, env_name: str, provider: str) -> str:
    if not key:
        raise LLMError(f"LLM_PROVIDER={provider} but {env_name} is not set in .env.")
    return key


async def _anthropic(
    prompt: str, schema: dict[str, Any] | None, temperature: float | None, model: str | None = None
) -> Any:
    headers = {
        "x-api-key": _require_key(settings.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY", "anthropic"),
        "anthropic-version": ANTHROPIC_VERSION,
    }
    data = await _post(ANTHROPIC_URL, headers, build_anthropic_payload(prompt, schema, temperature, model), "Anthropic")
    return parse_anthropic_response(data, expect_json=schema is not None)


async def _openai(
    prompt: str, schema: dict[str, Any] | None, temperature: float | None, model: str | None = None
) -> Any:
    headers = {
        "Authorization": f"Bearer {_require_key(settings.OPENAI_API_KEY, 'OPENAI_API_KEY', 'openai')}"
    }
    data = await _post(OPENAI_URL, headers, build_openai_payload(prompt, schema, temperature, model), "OpenAI")
    return parse_openai_response(data, expect_json=schema is not None)


async def _openrouter(
    prompt: str, schema: dict[str, Any] | None, temperature: float | None, model: str | None = None
) -> Any:
    headers = {
        "Authorization": f"Bearer {_require_key(settings.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY', 'openrouter')}"
    }
    payload = with_openrouter_reasoning(
        build_openai_payload(prompt, schema, temperature, model=model or settings.OPENROUTER_MODEL)
    )
    data = await _post(OPENROUTER_URL, headers, payload, "OpenRouter")
    return parse_openai_response(data, expect_json=schema is not None)


async def _gemini(
    prompt: str, schema: dict[str, Any] | None, temperature: float | None, model: str | None = None
) -> Any:
    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    headers = {"x-goog-api-key": key}
    m = model or settings.GEMINI_MODEL
    url = f"{GEMINI_BASE}/models/{m}:generateContent"
    data = await _post(url, headers, build_gemini_payload(prompt, schema, temperature), "Gemini", model=m)
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


async def _openrouter_stream(prompt: str, temperature: float | None) -> AsyncIterator[str]:
    headers = {
        "Authorization": f"Bearer {_require_key(settings.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY', 'openrouter')}"
    }
    payload = with_openrouter_reasoning(
        build_openai_payload(prompt, None, temperature, model=settings.OPENROUTER_MODEL)
    )
    payload["stream"] = True
    async for line in _stream_lines(OPENROUTER_URL, headers, payload, "OpenRouter"):
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
    if p == "openrouter":
        return await _openrouter(prompt, None, temperature)
    if p == "gemini":
        return await _gemini(prompt, None, temperature)
    return await _ollama_generate(prompt, temperature=temperature)


async def generate_json(
    prompt: str, schema: dict[str, Any], *, temperature: float | None = None, tier: str = "fast"
) -> dict[str, Any]:
    """Structured generation, routed by provider. `tier="smart"` routes to the provider's
    *_MODEL_SMART slot (judge/planner-grade calls: writing assessment, weekly Planner) and falls
    back to the base model when the slot is unset — so tiering is opt-in, config-only."""
    p = _provider()
    model = _model_for(p, tier)
    if p == "anthropic":
        return await _anthropic(prompt, schema, temperature, model)
    if p == "openai":
        return await _openai(prompt, schema, temperature, model)
    if p == "openrouter":
        return await _openrouter(prompt, schema, temperature, model)
    if p == "gemini":
        return await _gemini(prompt, schema, temperature, model)
    return await _ollama_generate_json(prompt, schema, temperature=temperature, model=model)


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
    if p == "openrouter":
        async for delta in _openrouter_stream(prompt, temperature):
            yield delta
        return
    if p == "gemini":
        async for delta in _gemini_stream(prompt, temperature):
            yield delta
        return
    async for chunk in _ollama_generate_stream(prompt, temperature=temperature):
        yield chunk


def active_model(tier: str = "fast") -> str:
    """The model the current provider will use for `tier` (for logs / eval reports)."""
    return _model_for(_provider(), tier)
