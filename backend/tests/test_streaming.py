"""Streaming primitive: Ollama NDJSON + Anthropic/OpenAI SSE line parsing + provider-routed
generate_stream (all offline — no network)."""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import llm
from app.services.llm import parse_anthropic_sse_line, parse_openai_sse_line
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


# --- Anthropic SSE parser ----------------------------------------------------
def test_anthropic_sse_extracts_text_delta():
    line = '{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hel"}}'
    assert parse_anthropic_sse_line(f"data: {line}") == "Hel"


def test_anthropic_sse_ignores_control_and_junk():
    assert parse_anthropic_sse_line("") == ""
    assert parse_anthropic_sse_line("event: content_block_delta") == ""  # not a data line
    assert parse_anthropic_sse_line("data: [DONE]") == ""
    assert parse_anthropic_sse_line('data: {"type": "message_stop"}') == ""  # no text
    assert parse_anthropic_sse_line('data: {"type": "content_block_delta", "delta": {"type": "input_json_delta"}}') == ""
    assert parse_anthropic_sse_line("data: not json") == ""


# --- OpenAI SSE parser -------------------------------------------------------
def test_openai_sse_extracts_content_delta():
    line = '{"choices": [{"delta": {"content": "lo"}}]}'
    assert parse_openai_sse_line(f"data: {line}") == "lo"


def test_openai_sse_ignores_control_and_junk():
    assert parse_openai_sse_line("data: [DONE]") == ""
    assert parse_openai_sse_line('data: {"choices": [{"delta": {}}]}') == ""  # role frame, no content
    assert parse_openai_sse_line('data: {"choices": []}') == ""
    assert parse_openai_sse_line("data: not json") == ""
    assert parse_openai_sse_line("") == ""


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


async def test_generate_stream_routes_to_anthropic_sse(monkeypatch):
    monkeypatch.setattr(llm, "_provider", lambda: "anthropic")

    async def fake_anthropic_stream(prompt, temperature):
        for tok in ["Try ", "the ", "past tense."]:
            yield tok

    monkeypatch.setattr(llm, "_anthropic_stream", fake_anthropic_stream)
    chunks = await _collect(llm.generate_stream("p"))
    assert "".join(chunks) == "Try the past tense."


async def test_generate_stream_routes_to_openai_sse(monkeypatch):
    monkeypatch.setattr(llm, "_provider", lambda: "openai")

    async def fake_openai_stream(prompt, temperature):
        for tok in ["a ", "b ", "c"]:
            yield tok

    monkeypatch.setattr(llm, "_openai_stream", fake_openai_stream)
    chunks = await _collect(llm.generate_stream("p"))
    assert chunks == ["a ", "b ", "c"]


# --- streaming generators filter control frames via the parsers ---------------
async def test_anthropic_stream_yields_only_text_deltas(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "k")

    async def fake_lines(url, headers, payload, name):
        assert payload["stream"] is True
        yield 'data: {"type": "message_start"}'
        yield 'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi "}}'
        yield 'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "there"}}'
        yield "data: [DONE]"

    monkeypatch.setattr(llm, "_stream_lines", fake_lines)
    chunks = await _collect(llm._anthropic_stream("p", None))
    assert chunks == ["Hi ", "there"]
