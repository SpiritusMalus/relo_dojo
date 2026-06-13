"""Sealed-token round-trip and tamper resistance (app.services.tokens)."""

import pytest

from app.services import tokens


def test_seal_unseal_roundtrip():
    payload = {"t": "multiple-choice", "answer": "an"}
    sealed = tokens.seal(payload)
    assert isinstance(sealed, str) and sealed
    assert tokens.unseal(sealed) == payload


def test_unseal_rejects_tampered_token():
    sealed = tokens.seal({"t": "tap-the-error", "index": 2})
    tampered = sealed[:-4] + ("aaaa" if not sealed.endswith("aaaa") else "bbbb")
    with pytest.raises(tokens.TokenError):
        tokens.unseal(tampered)


def test_unseal_rejects_garbage():
    with pytest.raises(tokens.TokenError):
        tokens.unseal("not-a-real-token")


def test_answer_never_appears_in_plaintext_token():
    sealed = tokens.seal({"t": "multiple-choice", "answer": "supercalifragilistic"})
    assert "supercalifragilistic" not in sealed


def test_fresh_token_unseals_within_ttl(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "EXERCISE_TOKEN_TTL_S", 60)
    sealed = tokens.seal({"t": "multiple-choice", "answer": "an"})
    assert tokens.unseal(sealed) == {"t": "multiple-choice", "answer": "an"}


def test_expired_token_is_rejected(monkeypatch):
    import json
    import time

    from app.core.config import settings

    monkeypatch.setattr(settings, "EXERCISE_TOKEN_TTL_S", 10)
    # Craft a token timestamped well in the past — beyond the 10s TTL.
    old = tokens._fernet.encrypt_at_time(
        json.dumps({"t": "multiple-choice", "answer": "an"}).encode(), int(time.time()) - 1000
    ).decode()
    with pytest.raises(tokens.TokenError):
        tokens.unseal(old)
