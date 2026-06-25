"""Provider abstraction (llm.py) — offline tests: payload builders, parsers, routing. No network."""

import pytest

from app.core.config import settings
from app.services import llm
from app.services.llm import (
    LLMError,
    active_model,
    build_anthropic_payload,
    build_gemini_payload,
    build_openai_payload,
    parse_anthropic_response,
    parse_gemini_response,
    parse_gemini_sse_line,
    parse_openai_response,
    to_gemini_schema,
)


# --- payload builders -----------------------------------------------------------
def test_anthropic_payload_forces_tool_for_json():
    p = build_anthropic_payload("hi", schema={"type": "object"}, temperature=0.2)
    assert p["tool_choice"] == {"type": "tool", "name": "emit"}
    assert p["tools"][0]["input_schema"] == {"type": "object"}
    assert p["temperature"] == 0.2
    assert p["max_tokens"] == settings.LLM_MAX_TOKENS
    # plain text mode: no tools at all
    assert "tools" not in build_anthropic_payload("hi")


def test_openai_payload_uses_json_schema_response_format():
    p = build_openai_payload("hi", schema={"type": "object"}, temperature=0.7)
    assert p["response_format"]["type"] == "json_schema"
    assert p["response_format"]["json_schema"]["schema"] == {"type": "object"}
    assert "response_format" not in build_openai_payload("hi")
    # default model is OPENAI_MODEL; the `model` arg overrides it (the OpenRouter path uses this).
    assert build_openai_payload("hi")["model"] == settings.OPENAI_MODEL
    assert build_openai_payload("hi", model="google/gemini-3.1-flash-lite")["model"] == "google/gemini-3.1-flash-lite"


def test_gemini_payload_sets_json_mime_and_response_schema():
    schema = {
        "type": "object",
        "properties": {"options": {"type": "array", "items": {"type": "string"}}},
        "required": ["options"],
    }
    p = build_gemini_payload("hi", schema=schema, temperature=0.2)
    cfg = p["generationConfig"]
    assert p["contents"] == [{"parts": [{"text": "hi"}]}]
    assert cfg["temperature"] == 0.2
    assert cfg["maxOutputTokens"] == settings.LLM_MAX_TOKENS
    assert cfg["responseMimeType"] == "application/json"
    # schema maps cleanly to the OpenAPI subset (structure preserved)
    assert cfg["responseSchema"] == schema
    # plain-text mode: no JSON config at all
    plain = build_gemini_payload("hi")["generationConfig"]
    assert "responseMimeType" not in plain and "responseSchema" not in plain


def test_to_gemini_schema_strips_unsupported_keys():
    # additionalProperties / extra metadata are dropped; type/properties/items/required survive.
    mapped = to_gemini_schema(
        {
            "type": "object",
            "additionalProperties": False,
            "title": "x",
            "properties": {"text": {"type": "string", "minLength": 1}},
            "required": ["text"],
        }
    )
    assert mapped == {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
    # nothing mappable -> None, so the caller falls back to JSON-mime only
    assert to_gemini_schema({"additionalProperties": False}) is None


def test_gemini_payload_falls_back_to_json_mime_when_schema_unmappable():
    cfg = build_gemini_payload("hi", schema={"additionalProperties": False})["generationConfig"]
    assert cfg["responseMimeType"] == "application/json"
    assert "responseSchema" not in cfg


# --- parsers ----------------------------------------------------------------------
def test_parse_anthropic_tool_use_and_text():
    data = {"content": [{"type": "tool_use", "input": {"answer": "at"}}]}
    assert parse_anthropic_response(data, expect_json=True) == {"answer": "at"}
    data = {"content": [{"type": "text", "text": " hello "}]}
    assert parse_anthropic_response(data, expect_json=False) == "hello"
    with pytest.raises(LLMError):
        parse_anthropic_response({"content": []}, expect_json=True)


def test_parse_openai_json_and_text():
    data = {"choices": [{"message": {"content": '{"answer": "at"}'}}]}
    assert parse_openai_response(data, expect_json=True) == {"answer": "at"}
    data = {"choices": [{"message": {"content": " hello "}}]}
    assert parse_openai_response(data, expect_json=False) == "hello"
    with pytest.raises(LLMError):
        parse_openai_response({"choices": [{"message": {"content": "not json"}}]}, expect_json=True)
    with pytest.raises(LLMError):
        parse_openai_response({}, expect_json=False)


def test_parse_gemini_json_and_text():
    data = {"candidates": [{"content": {"parts": [{"text": '{"answer": "at"}'}]}}]}
    assert parse_gemini_response(data, expect_json=True) == {"answer": "at"}
    # multi-part text is concatenated, then stripped
    data = {"candidates": [{"content": {"parts": [{"text": " hel"}, {"text": "lo "}]}}]}
    assert parse_gemini_response(data, expect_json=False) == "hello"
    with pytest.raises(LLMError):
        parse_gemini_response(
            {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}, expect_json=True
        )
    # blocked / empty candidate (e.g. safety finishReason, no parts) -> LLMError
    with pytest.raises(LLMError):
        parse_gemini_response({"candidates": [{"content": {}}]}, expect_json=False)


def test_parse_gemini_sse_line():
    frame = 'data: {"candidates": [{"content": {"parts": [{"text": "hi"}]}}]}'
    assert parse_gemini_sse_line(frame) == "hi"
    assert parse_gemini_sse_line("data: [DONE]") == ""
    assert parse_gemini_sse_line(": keep-alive") == ""
    assert parse_gemini_sse_line("data: {not json") == ""


# --- routing ----------------------------------------------------------------------
async def test_generate_json_routes_by_provider(monkeypatch):
    calls: list[str] = []

    async def fake_ollama(prompt, schema, *, temperature=None):
        calls.append("ollama")
        return {}

    async def fake_api(prompt, schema, temperature):
        calls.append("api")
        return {}

    monkeypatch.setattr(llm, "_ollama_generate_json", fake_ollama)
    monkeypatch.setattr(llm, "_anthropic", fake_api)
    monkeypatch.setattr(llm, "_openai", fake_api)
    monkeypatch.setattr(llm, "_openrouter", fake_api)
    monkeypatch.setattr(llm, "_gemini", fake_api)

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    await llm.generate_json("p", {})
    assert calls == ["ollama", "api", "api", "api", "api"]


async def test_openrouter_requires_key(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "")
    with pytest.raises(LLMError, match="OPENROUTER_API_KEY"):
        await llm.generate_json("p", {})


async def test_gemini_requires_key(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    with pytest.raises(LLMError, match="GEMINI_API_KEY"):
        await llm.generate_json("p", {})


async def test_api_provider_requires_key(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        await llm.generate_json("p", {})


def test_active_model_follows_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    assert active_model() == settings.OLLAMA_MODEL
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    assert active_model() == settings.ANTHROPIC_MODEL
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    assert active_model() == settings.OPENAI_MODEL
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    assert active_model() == settings.OPENROUTER_MODEL
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    assert active_model() == settings.GEMINI_MODEL
