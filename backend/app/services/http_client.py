"""Shared pooled HTTP client for the LLM paths (llm.py + ollama_client.py).

Every LLM call used to build a fresh httpx.AsyncClient — a TLS handshake per request, with up to
five requests behind a single exercise (generation retries + fallback). One pooled client keeps
connections alive across calls instead. Lazily created so importing costs nothing; closed on app
shutdown (main.lifespan) and re-created transparently if used again (scripts, evals, tests).
"""

from __future__ import annotations

import httpx

TIMEOUT = 120.0

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    """The shared client (created on first use, revived after aclose)."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=TIMEOUT)
    return _client


async def aclose() -> None:
    """Close the pooled client and its connections. Safe to call twice."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
