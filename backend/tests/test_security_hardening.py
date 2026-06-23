"""Deploy-coupled hardening from the 2026-06-23 security audit:
  - RD-07: Swagger/OpenAPI off in prod (schema-disclosure).
  - RD-08: defence-in-depth response headers (HSTS prod-only).
  - RD-09: CHECK_SECRET required in prod (no silent ephemeral Fernet key).
All keyed off settings.ENV / settings.is_prod (default "dev")."""

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import main
from app.core.config import settings
from app.services import tokens


# --- ENV / is_prod -----------------------------------------------------------
def test_is_prod_recognizes_prod_values(monkeypatch):
    for val in ("prod", "production", "PROD", " Production "):
        monkeypatch.setattr(settings, "ENV", val)
        assert settings.is_prod is True
    for val in ("dev", "", "staging", "local"):
        monkeypatch.setattr(settings, "ENV", val)
        assert settings.is_prod is False


# --- RD-07: docs gating ------------------------------------------------------
def test_docs_disabled_in_prod_enabled_in_dev():
    assert main._docs_kwargs(True) == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    dev = main._docs_kwargs(False)
    assert dev["docs_url"] == "/docs" and dev["openapi_url"] == "/openapi.json"


# --- RD-08: security headers -------------------------------------------------
def _client(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_MIGRATE", False)  # no DB on startup in the test
    return TestClient(main.app)


def test_security_headers_present_dev_has_no_hsts(monkeypatch):
    monkeypatch.setattr(settings, "ENV", "dev")
    with _client(monkeypatch) as client:
        r = client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "Permissions-Policy" in r.headers
    assert "Strict-Transport-Security" not in r.headers  # HSTS is prod-only


def test_hsts_emitted_in_prod(monkeypatch):
    monkeypatch.setattr(settings, "ENV", "prod")
    with _client(monkeypatch) as client:
        r = client.get("/health")
    assert "max-age=" in r.headers.get("Strict-Transport-Security", "")


# --- RD-09: CHECK_SECRET required in prod ------------------------------------
def test_build_fernet_requires_check_secret_in_prod(monkeypatch):
    monkeypatch.setattr(tokens, "CHECK_SECRET", "")
    monkeypatch.setattr(settings, "ENV", "prod")
    with pytest.raises(RuntimeError, match="CHECK_SECRET is required"):
        tokens._build_fernet()


def test_build_fernet_allows_ephemeral_key_in_dev(monkeypatch):
    monkeypatch.setattr(tokens, "CHECK_SECRET", "")
    monkeypatch.setattr(settings, "ENV", "dev")
    assert isinstance(tokens._build_fernet(), Fernet)  # zero-config dev convenience preserved
