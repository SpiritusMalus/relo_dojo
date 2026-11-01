"""Explicit smart streaming reaches the wire; default and empty smart slots retain the base model."""
import pytest

from app.core.config import settings
from app.services import llm


@pytest.mark.parametrize("provider", ["openrouter", "openai", "anthropic", "gemini", "ollama"])
@pytest.mark.parametrize("mode", ["default", "smart", "smart-empty"])
async def test_stream_tier_selects_configured_model_without_changing_default(monkeypatch, provider, mode):
    prefix = provider.upper()
    monkeypatch.setattr(settings, "LLM_PROVIDER", provider)
    monkeypatch.setattr(settings, prefix + "_MODEL", "base-offline")
    monkeypatch.setattr(settings, prefix + "_MODEL_SMART", "" if mode == "smart-empty" else "smart-offline")
    if provider != "ollama":
        monkeypatch.setattr(settings, prefix + "_API_KEY", "offline-test-only")
    seen = []

    async def fake_lines(url, headers, payload, name, model=""):
        seen.append(url.split("/models/", 1)[1].split(":", 1)[0] if provider == "gemini" else payload["model"])
        if provider == "anthropic":
            yield 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"grounded"}}'
        elif provider == "gemini":
            yield 'data: {"candidates":[{"content":{"parts":[{"text":"grounded"}]}}]}'
        else:
            yield 'data: {"choices":[{"delta":{"content":"grounded"}}]}'

    async def fake_ollama(prompt, *, temperature=None, model=None):
        seen.append(model)
        yield "grounded"

    monkeypatch.setattr(llm, "_stream_lines", fake_lines)
    monkeypatch.setattr(llm, "_ollama_generate_stream", fake_ollama)
    kwargs = {} if mode == "default" else {"tier": "smart"}
    assert [chunk async for chunk in llm.generate_stream("synthetic", **kwargs)] == ["grounded"]
    assert seen == ["smart-offline" if mode == "smart" else "base-offline"]
