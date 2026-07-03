"""Transport hardening (llm.py + http_client.py): transient-failure retry, the pooled client, and
smart-tier model routing. Offline — the pooled client is swapped for a MockTransport, backoff zeroed."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.core.config import settings
from app.services import http_client, llm, ollama_client
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
    # client() is loop-affine — pin the injected client to the test's loop or it gets replaced.
    monkeypatch.setattr(http_client, "_loop", asyncio.get_running_loop())
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


async def test_post_maps_402_to_an_out_of_credits_message(monkeypatch):
    # OpenRouter's paid models 402 the moment the account balance hits zero — the fix is topping
    # up, not touching the key, and the message must say so.
    calls = _install(monkeypatch, [httpx.Response(402, json={"error": {"message": "Insufficient credits", "code": 402}})])
    with pytest.raises(LLMError, match="out of credits"):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == 1
    await http_client.aclose()


async def test_post_surfaces_the_provider_reason_on_403(monkeypatch):
    # A 403 is a per-request refusal (moderation/guardrail flag or key permissions), NOT a bad key.
    # The provider's own reason — the only clue to WHY — must reach the message and the logs.
    body = {
        "error": {
            "code": 403,
            "message": "Your input was flagged",
            "metadata": {"reasons": ["violence"], "flagged_input": "…"},
        }
    }
    calls = _install(monkeypatch, [httpx.Response(403, json=body)])
    with pytest.raises(LLMError, match=r"refused this request.*flagged.*violence"):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == 1  # per-request refusal: transport-level retries would re-flag the same input
    await http_client.aclose()


async def test_post_raises_the_timeout_subclass(monkeypatch):
    # Timeouts already consumed the full HTTP window; app-level retry loops key off this subclass
    # to avoid stacking more of them. isinstance(LLMError) still holds for the 503 handler.
    calls = _install(monkeypatch, [httpx.ReadTimeout("slow")])
    with pytest.raises(llm.LLMTimeoutError):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == 1
    await http_client.aclose()


async def test_post_gives_up_after_the_retry_budget(monkeypatch):
    calls = _install(monkeypatch, [httpx.Response(503, text="down")])
    with pytest.raises(LLMError, match="503"):
        await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert calls["n"] == llm.LLM_RETRIES + 1
    await http_client.aclose()


async def test_post_retries_a_stale_keepalive_connection(monkeypatch):
    # The pooled client can pick up a keep-alive connection the server closed meanwhile —
    # "server disconnected" must be retried on a fresh connection, not surfaced as a 503.
    ok = httpx.Response(200, json={"ok": 1})
    calls = _install(monkeypatch, [httpx.RemoteProtocolError("server disconnected"), ok])
    data = await llm._post("https://api.test/v1", {}, {"model": "m"}, "Test")
    assert data["ok"] == 1
    assert calls["n"] == 2
    await http_client.aclose()


async def test_ollama_generate_retries_a_stale_keepalive(monkeypatch):
    responses = [
        httpx.RemoteProtocolError("server disconnected"),
        httpx.Response(200, json={"response": " hi "}),
    ]
    calls = _install(monkeypatch, responses)
    out = await ollama_client.generate("p")
    assert out == "hi"
    assert calls["n"] == 2
    await http_client.aclose()


async def test_ollama_generate_json_retries_truncated_json(monkeypatch):
    # format-constrained decoding still occasionally truncates mid-string (3/53 in the live eval);
    # sampling makes it transient — one fresh generation, then give up.
    responses = [
        httpx.Response(200, json={"response": '{"correct": true, "explanation": "You wer'}),
        httpx.Response(200, json={"response": '{"ok": 1}'}),
    ]
    calls = _install(monkeypatch, responses)
    out = await ollama_client.generate_json("p", {"type": "object"})
    assert out == {"ok": 1}
    assert calls["n"] == 2
    await http_client.aclose()


async def test_ollama_generate_json_gives_up_after_second_bad_json(monkeypatch):
    responses = [
        httpx.Response(200, json={"response": "{bad"}),
        httpx.Response(200, json={"response": "{still bad"}),
    ]
    _install(monkeypatch, responses)
    with pytest.raises(LLMError, match="invalid JSON"):
        await ollama_client.generate_json("p", {"type": "object"})
    await http_client.aclose()


# --- pooled client ------------------------------------------------------------------
def test_pooled_client_survives_multiple_event_loops():
    # Multi-asyncio.run scripts (evals) must not inherit a client whose loop is closed —
    # that's the "RuntimeError: Event loop is closed" crash.
    async def _use():
        return http_client.client()

    c1 = asyncio.run(_use())
    c2 = asyncio.run(_use())
    assert c2 is not c1  # the loop changed → a fresh client, never the loop-dead one


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


# --- reasoning-effort knob (OpenRouter only) --------------------------------------------
async def test_openrouter_reasoning_effort_reaches_the_payload(monkeypatch):
    seen: dict = {}

    async def fake_post(url, headers, payload, name, model=""):
        seen["payload"] = payload
        return {"choices": [{"message": {"content": "{}"}}]}

    monkeypatch.setattr(llm, "_post", fake_post)
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setattr(settings, "OPENROUTER_REASONING_EFFORT", "none")
    await llm.generate_json("p", {"type": "object"})
    assert seen["payload"]["reasoning"] == {"effort": "none"}  # Gemini 3.x: thinking off = 1.5s not 10s

    monkeypatch.setattr(settings, "OPENROUTER_REASONING_EFFORT", "")
    await llm.generate_json("p", {"type": "object"})
    assert "reasoning" not in seen["payload"]  # empty = provider default, payload untouched


def test_error_reason_pulls_the_provider_message():
    body = '{"error": {"code": 403, "message": "Key limit exceeded", "metadata": {"reasons": ["limit"]}}}'
    assert llm._error_reason(body) == "Key limit exceeded (reasons: ['limit'])"
    assert llm._error_reason("plain\n  text  ") == "plain text"  # non-JSON bodies collapse to one line
    assert llm._error_reason("") == ""
