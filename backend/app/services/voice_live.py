"""Gemini Live token + model resolution (voice mode b), server-side.

The client opens a realtime client↔Google Live WebSocket, but it must NOT carry the real
GEMINI_API_KEY (an embedded EXPO_PUBLIC_* var ships in the bundle and is extractable). So the server
mints a short-lived EPHEMERAL token from the real key and hands only that to the client. We also
resolve the live model id from the model list here (never hardcode — mirrors the llm.py rule and the
client's pickLiveModel), and cache it.

No key is needed to build/unit-test this (Google is mocked). Live e2e shares the one paid
GEMINI_API_KEY already pending for llm-provider-gemini.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import httpx

from ..core.config import settings
from .llm import GEMINI_BASE, LLMError, _raise_for_status, _require_key

GEMINI_ALPHA = "https://generativelanguage.googleapis.com/v1alpha"
# Ephemeral tokens are deliberately short-lived (single session, low-minute TTL).
LIVE_TOKEN_TTL_SECONDS = 30 * 60

_cached_model: str | None = None


def pick_live_model(models: list[str]) -> str | None:
    """Pick the best native-audio flash-live model id (prefers native-audio, then a flash+live id).
    Returns None when none qualify — the caller surfaces 'unavailable' rather than guessing. Mirrors
    the client's services/voice pickLiveModel."""
    ids = [re.sub(r"^models/", "", m) for m in models]
    candidates = [m for m in ids if re.search(r"flash", m, re.I) and re.search(r"live|native-audio", m, re.I)]
    if not candidates:
        return None
    candidates.sort(key=lambda m: (0 if re.search(r"native-audio", m, re.I) else 1, len(m)))
    return candidates[0]


async def _list_models(key: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{GEMINI_BASE}/models", headers={"x-goog-api-key": key})
    except httpx.ConnectError as exc:
        raise LLMError("Cannot reach the Gemini API — check the network.") from exc
    except httpx.TimeoutException as exc:
        raise LLMError("The Gemini API timed out.") from exc
    _raise_for_status(resp.status_code, "Gemini", resp.text)
    data = resp.json()
    return [str(m.get("name") or "") for m in (data.get("models") or []) if m.get("name")]


async def resolve_live_model(key: str | None = None) -> str:
    """Resolve (and cache) the live model id. Raises LLMError if none is available."""
    global _cached_model
    if _cached_model:
        return _cached_model
    k = key or _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    model = pick_live_model(await _list_models(k))
    if not model:
        raise LLMError("No Gemini live (flash native-audio) model available.")
    _cached_model = model
    return model


def _reset_model_cache() -> None:
    """Tests: drop the cached live-model id."""
    global _cached_model
    _cached_model = None


async def mint_live_token() -> tuple[str, str]:
    """Mint a short-lived ephemeral Live auth token from the real key. Returns (token, expiresAt ISO).
    NEVER returns the raw GEMINI_API_KEY. Raises LLMError if the ephemeral-token API rejects/unavailable.
    """
    key = _require_key(settings.GEMINI_API_KEY, "GEMINI_API_KEY", "gemini")
    expire = datetime.now(timezone.utc) + timedelta(seconds=LIVE_TOKEN_TTL_SECONDS)
    body = {
        "uses": 1,  # single Live session
        "expireTime": expire.isoformat().replace("+00:00", "Z"),
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{GEMINI_ALPHA}/auth_tokens", json=body, headers={"x-goog-api-key": key}
            )
    except httpx.ConnectError as exc:
        raise LLMError("Cannot reach the Gemini API — check the network.") from exc
    except httpx.TimeoutException as exc:
        raise LLMError("The Gemini API timed out.") from exc
    _raise_for_status(resp.status_code, "Gemini", resp.text)
    data = resp.json()
    # The token to use is the resource name ("auth_tokens/<token>"); fall back to a `token` field.
    token = str(data.get("name") or data.get("token") or "")
    if not token:
        raise LLMError("Gemini ephemeral-token response carried no token.")
    return token, body["expireTime"]
