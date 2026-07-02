"""Shared pooled HTTP client for the LLM paths (llm.py + ollama_client.py).

Every LLM call used to build a fresh httpx.AsyncClient — a TLS handshake per request, with up to
five requests behind a single exercise (generation retries + fallback). One pooled client keeps
connections alive across calls instead. Lazily created so importing costs nothing; closed on app
shutdown (main.lifespan) and re-created transparently if used again (scripts, evals, tests).
"""

from __future__ import annotations

import asyncio

import httpx

TIMEOUT = 120.0

_client: httpx.AsyncClient | None = None
_loop: asyncio.AbstractEventLoop | None = None


def client() -> httpx.AsyncClient:
    """The shared client for the CURRENT event loop (created on first use, revived after aclose).

    Loop-affine: pooled connections belong to the loop they were opened on, so a client created
    under one `asyncio.run()` crashes with "Event loop is closed" when reused under the next
    (multi-run scripts: evals, one-off tools). When the loop changed, the old client is simply
    abandoned — its connections died with their loop and cannot be closed from this one."""
    global _client, _loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _loop is not loop:
        _client = httpx.AsyncClient(timeout=TIMEOUT)
        _loop = loop
    return _client


async def aclose() -> None:
    """Close the pooled client and its connections. Safe to call twice."""
    global _client, _loop
    if _client is not None and not _client.is_closed and _loop is asyncio.get_running_loop():
        await _client.aclose()
    _client = None
    _loop = None
