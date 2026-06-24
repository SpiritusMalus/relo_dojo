"""Voice endpoints (/voice/transcribe + /voice/live-token) — Google fully mocked (no live key).

Covers the 404 flag-gate, auth, the read-aloud size guard, provider-error mapping, the rate limit,
the ephemeral Live-token shape, and the security invariant that the raw GEMINI_API_KEY never appears
in a response. The live model resolution is unit-tested as a pure function.
"""

import base64
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.services import voice_live, voice_transcribe
from app.services.llm import LLMError

B64 = base64.b64encode(b"\x00\x01\x02\x03fake-audio").decode()


# ── helpers ──────────────────────────────────────────────────────────────────
def _client(monkeypatch, *, enabled=True, authed=True):
    from app import main
    from app.core.config import settings as _settings
    from app import deps

    monkeypatch.setattr(_settings, "AUTO_MIGRATE", False)
    monkeypatch.setattr(_settings, "VOICE_ENABLED", enabled)
    deps._voice_limiter.reset()  # isolate the rate-limit state between tests
    main.app.dependency_overrides.clear()
    # voice endpoints don't use the DB; stub get_db so unauth paths never touch Postgres.
    main.app.dependency_overrides[deps.get_db] = lambda: None
    if authed:
        main.app.dependency_overrides[deps.get_current_user] = lambda: SimpleNamespace(id=uuid.uuid4())
    return TestClient(main.app)


def _clear():
    from app import main

    main.app.dependency_overrides.clear()


# ── /voice/transcribe ─────────────────────────────────────────────────────────
def test_transcribe_404_when_voice_disabled(monkeypatch):
    client = _client(monkeypatch, enabled=False)
    try:
        r = client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a"})
        assert r.status_code == 404  # the whole surface is invisible until VOICE_ENABLED
    finally:
        _clear()


def test_transcribe_401_when_unauthenticated(monkeypatch):
    client = _client(monkeypatch, enabled=True, authed=False)
    try:
        r = client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a"})
        assert r.status_code == 401
    finally:
        _clear()


def test_transcribe_happy_path_returns_transcript(monkeypatch):
    async def fake_transcribe(audio, mime, lang=None):
        return "I went to the shop"

    monkeypatch.setattr(voice_transcribe, "transcribe", fake_transcribe)
    client = _client(monkeypatch)
    try:
        r = client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a", "lang": "en"})
        assert r.status_code == 200
        assert r.json() == {"transcript": "I went to the shop"}
    finally:
        _clear()


def test_transcribe_413_when_audio_over_size(monkeypatch):
    from app.core.config import settings as _settings

    monkeypatch.setattr(_settings, "VOICE_MAX_AUDIO_BYTES", 4)  # tiny cap → our 11-byte clip is over
    client = _client(monkeypatch)
    try:
        r = client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a"})
        assert r.status_code == 413
    finally:
        _clear()


def test_transcribe_400_on_bad_base64(monkeypatch):
    client = _client(monkeypatch)
    try:
        r = client.post("/voice/transcribe", json={"audio": "!!!not-base64!!!", "mime": "audio/m4a"})
        assert r.status_code == 400
    finally:
        _clear()


def test_transcribe_maps_provider_error_to_502(monkeypatch):
    async def boom(audio, mime, lang=None):
        raise LLMError("Gemini API key missing or rejected — check the key in .env.")

    monkeypatch.setattr(voice_transcribe, "transcribe", boom)
    client = _client(monkeypatch)
    try:
        r = client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a"})
        assert r.status_code == 502
    finally:
        _clear()


def test_transcribe_rate_limited_after_budget(monkeypatch):
    from app.core.config import settings as _settings

    async def fake_transcribe(audio, mime, lang=None):
        return "ok"

    monkeypatch.setattr(voice_transcribe, "transcribe", fake_transcribe)
    monkeypatch.setattr(_settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(_settings, "VOICE_RATE_LIMIT", 3)
    client = _client(monkeypatch)
    # The limiter was built at import with the default budget; drive it directly to a tiny limit.
    from app import deps
    from app.core.ratelimit import SlidingWindowLimiter

    monkeypatch.setattr(deps, "_voice_limiter", SlidingWindowLimiter(3, 60))
    try:
        codes = [client.post("/voice/transcribe", json={"audio": B64, "mime": "audio/m4a"}).status_code for _ in range(4)]
        assert codes[:3] == [200, 200, 200]
        assert codes[3] == 429  # over the conservative voice budget
    finally:
        _clear()


# ── /voice/live-token ──────────────────────────────────────────────────────────
def test_live_token_404_when_disabled(monkeypatch):
    client = _client(monkeypatch, enabled=False)
    try:
        assert client.post("/voice/live-token").status_code == 404
    finally:
        _clear()


def test_live_token_shape_and_never_leaks_raw_key(monkeypatch):
    from app.core.config import settings as _settings

    monkeypatch.setattr(_settings, "GEMINI_API_KEY", "SECRET-REAL-KEY-do-not-leak")

    async def fake_model():
        return "gemini-2.5-flash-native-audio-preview"

    async def fake_token():
        return ("auth_tokens/ephem-abc123", "2026-06-24T12:00:00Z")

    monkeypatch.setattr(voice_live, "resolve_live_model", fake_model)
    monkeypatch.setattr(voice_live, "mint_live_token", fake_token)
    client = _client(monkeypatch)
    try:
        r = client.post("/voice/live-token")
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "token": "auth_tokens/ephem-abc123",
            "expiresAt": "2026-06-24T12:00:00Z",
            "model": "gemini-2.5-flash-native-audio-preview",
        }
        # Security invariant: the real key must never appear anywhere in the response.
        assert "SECRET-REAL-KEY-do-not-leak" not in r.text
    finally:
        _clear()


# ── pure: live model resolution ────────────────────────────────────────────────
def test_pick_live_model_prefers_native_audio_flash():
    models = [
        "models/gemini-3.1-flash-lite",
        "models/gemini-2.5-flash-native-audio-preview-09-2025",
        "models/gemini-live-2.5-flash-preview",
    ]
    assert voice_live.pick_live_model(models) == "gemini-2.5-flash-native-audio-preview-09-2025"


def test_pick_live_model_falls_back_then_none():
    assert voice_live.pick_live_model(["gemini-live-2.5-flash-preview"]) == "gemini-live-2.5-flash-preview"
    assert voice_live.pick_live_model(["gemini-3.1-flash-lite", "gemini-2.5-pro"]) is None
    assert voice_live.pick_live_model([]) is None


def test_transcribe_payload_carries_inline_audio_and_verbatim_instruction():
    body = voice_transcribe.build_transcribe_payload(B64, "audio/m4a", "en")
    parts = body["contents"][0]["parts"]
    assert parts[0]["inline_data"] == {"mime_type": "audio/m4a", "data": B64}
    assert "verbatim" in parts[1]["text"].lower()
    assert body["generationConfig"]["temperature"] == 0
