"""Transport hardening (llm.py + http_client.py): transient-failure retry, the pooled client, and
smart-tier model routing. Offline — the pooled client is swapped for a MockTransport, backoff zeroed."""

from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.services import http_client, llm
from app.services.llm import LLMError


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    monkeypatch.setattr(llm, "RETRY_BACKOFF_S", 0)


def _install(monkeypatch, responses: list) -> dict:
    """Route http_client.client() through a MockTransport that replays `responses` in order
    (an Exception entry is raised instead). Returns a call counter. The last entry repeats."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        r = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(
        http_client, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    return calls


# --- retry policy -----------------------------------------------------------------
async def test_post_retries_a_transient_5xx(monkeypatch):
    ok = httpx.Response(200, json={"ok": 1, "usage": {"prompt_tokens": 5, "completion_tokens": 7}})
    calls = _install(monkeypatch, [httpx.Response(503, text="upstream hiccup"), ok])
    data = await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert data["ok"] == 1
    assert calls["n"] == 2  # one blip, one success — the user never saw a 503
    await http_client.aclose()


async def test_post_retries_a_connect_error(monkeypatch):
    ok = httpx.Response(200, json={"ok": 1})
    calls = _install(monkeypatch, [httpx.ConnectError("boom"), ok])
    data = await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert data["ok"] == 1
    assert calls["n"] == 2
    await http_client.aclose()


async def test_post_does_not_retry_auth_errors(monkeypatch):
    calls = _install(monkeypatch, [httpx.Response(401, text="bad key")])
    with pytest.raises(LLMError, match="key missing or rejected"):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == 1  # a rejected key never gets better — fail fast
    await http_client.aclose()


async def test_post_gives_up_after_the_retry_budget(monkeypatch):
    calls = _install(monkeypatch, [httpx.Response(503, text="down")])
    with pytest.raises(LLMError, match="503"):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == llm.LLM_RETRIES + 1
    await http_client.aclose()


# --- pooled client ------------------------------------------------------------------
async def test_pooled_client_is_reused_and_revived():
    c1 = http_client.client()
    assert http_client.client() is c1  # pooled: no per-call client
    await http_client.aclose()
    c2 = http_client.client()
    assert c2 is not c1 and not c2.is_closed  # revived transparently after shutdown
    await http_client.aclose()


# --- smart-tier routing ----------------------------------------------------------------
def test_model_for_smart_falls_back_to_the_base_slot(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_MODEL_SMART", "")
    assert llm._model_for("openrouter", "smart") == settings.OPENROUTER_MODEL
    monkeypatch.setattr(settings, "OPENROUTER_MODEL_SMART", "google/gemini-3.1-pro")
    assert llm._model_for("openrouter", "smart") == "google/gemini-3.1-pro"
    # the fast tier never reads the smart slot
    assert llm._model_for("openrouter", "fast") == settings.OPENROUTER_MODEL


def test_active_model_reports_the_tier(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OLLAMA_MODEL_SMART", "gemma3:12b")
    assert llm.active_model() == settings.OLLAMA_MODEL
    assert llm.active_model("smart") == "gemma3:12b"


async def test_generate_json_smart_tier_reaches_the_payload(monkeypatch):
    seen: dict = {}

    async def fake_post(url, headers, payload, name, model=""):
        seen["model"] = payload["model"]
        return {"choices": [{"message": {"content": "{}"}}]}

    monkeypatch.setattr(llm, "_post", fake_post)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setattr(settings, "OPENROUTER_MODEL_SMART", "google/gemini-3.1-pro")
    await llm.generate_json("p", {"type": "object"}, tier="smart")
    assert seen["model"] == "google/gemini-3.1-pro"
    await llm.generate_json("p", {"type": "object"})  # default tier stays on the base model
    assert seen["model"] == settings.OPENROUTER_MODEL
