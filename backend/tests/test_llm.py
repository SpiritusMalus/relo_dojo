"""Provider abstraction (llm.py) — offline tests: payload builders, parsers, routing. No network."""

import pytest

from app.core.config import settings
from app.services import llm
from app.services.llm import (
    LLMError,
    active_model,
    build_anthropic_payload,
    build_openai_payload,
    parse_anthropic_response,
    parse_openai_response,
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

    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    await llm.generate_json("p", {})
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    await llm.generate_json("p", {})
    assert calls == ["ollama", "api", "api"]


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
