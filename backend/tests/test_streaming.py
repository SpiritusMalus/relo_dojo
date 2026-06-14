"""Streaming primitive: Ollama NDJSON line parsing + the provider-routed generate_stream (offline)."""

from __future__ import annotations

import pytest

from app.services import llm
from app.services.ollama_client import parse_ollama_stream_line


# --- pure line parser --------------------------------------------------------
def test_parse_stream_line_extracts_delta():
    assert parse_ollama_stream_line('{"response": "Hel", "done": false}') == "Hel"
    assert parse_ollama_stream_line('{"response": "lo", "done": true}') == "lo"


def test_parse_stream_line_ignores_blank_done_and_junk():
    assert parse_ollama_stream_line("") == ""
    assert parse_ollama_stream_line("   ") == ""
    assert parse_ollama_stream_line('{"done": true}') == ""  # terminal frame, no text
    assert parse_ollama_stream_line("not json") == ""
    assert parse_ollama_stream_line("[1, 2, 3]") == ""  # not an object


async def _collect(aiter):
    return [c async for c in aiter]


# --- provider routing --------------------------------------------------------
async def test_generate_stream_uses_ollama_token_stream(monkeypatch):
    monkeypatch.setattr(llm, "_provider", lambda: "ollama")

    async def fake_ollama_stream(prompt, *, temperature=None):
        for tok in ["Once ", "upon ", "a time"]:
            yield tok

    monkeypatch.setattr(llm, "_ollama_generate_stream", fake_ollama_stream)
    chunks = await _collect(llm.generate_stream("p"))
    assert chunks == ["Once ", "upon ", "a time"]
    assert "".join(chunks) == "Once upon a time"


async def test_generate_stream_api_provider_falls_back_to_one_chunk(monkeypatch):
    monkeypatch.setattr(llm, "_provider", lambda: "anthropic")

    async def fake_generate(prompt, *, temperature=None):
        return "full reply"

    monkeypatch.setattr(llm, "generate", fake_generate)
    chunks = await _collect(llm.generate_stream("p"))
    assert chunks == ["full reply"]
