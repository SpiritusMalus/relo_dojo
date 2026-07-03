"""Feedback-retry: when a generator rejects the model's output, the NEXT attempt's prompt names the
defect ("fix exactly that") instead of blindly resending the same prompt. Offline (LLM mocked)."""

from __future__ import annotations

import pytest

from app.services import _grammar_generators as gen
from app.services.llm import LLMError, LLMTimeoutError


def test_retry_clause_empty_without_a_note():
    assert gen._retry_clause("") == ""
    assert "rejected" in gen._retry_clause("multiple-choice: missing text")


async def test_second_attempt_prompt_carries_the_rejection_reason(monkeypatch):
    prompts: list[str] = []
    outputs = [
        {"text": "", "options": [], "answer": ""},  # attempt 1: rejected (missing everything)
        {"text": "I arrive ___ 6 pm.", "options": ["at", "on"], "answer": "at"},  # attempt 2: fine
    ]

    async def fake(prompt, schema, temperature=0.0):
        prompts.append(prompt)
        return outputs[min(len(prompts) - 1, len(outputs) - 1)]

    monkeypatch.setattr(gen, "generate_json", fake)
    out = await gen.generate_exercise(topic="prepositions", ex_type="multiple-choice", level="A2")
    assert out["type"] == "multiple-choice"
    assert len(prompts) == 2
    assert "rejected" not in prompts[0]  # first attempt is clean
    assert "your previous output was rejected" in prompts[1]
    assert "missing text, options or answer" in prompts[1]  # the specific defect, not a generic nudge


async def test_fallback_to_multiple_choice_still_works(monkeypatch):
    calls = {"n": 0}

    async def fake(prompt, schema, temperature=0.0):
        calls["n"] += 1
        if calls["n"] <= 3:  # the chosen type exhausts its 3 attempts...
            return {"pairs": []}
        return {"text": "I arrive ___ 6 pm.", "options": ["at", "on"], "answer": "at"}

    monkeypatch.setattr(gen, "generate_json", fake)
    out = await gen.generate_exercise(topic="prepositions", ex_type="match-pairs", level="A2")
    assert out["type"] == "multiple-choice"  # ...then the fallback ships a simpler card
    assert calls["n"] == 4


# --- transient LLM failures spend an attempt instead of 503ing the card (prod: a per-request
# OpenRouter guardrail 403 on exercise 2 killed the lesson while the retry ladder sat unused) ---
async def test_a_transient_llm_error_spends_one_attempt_not_the_card(monkeypatch):
    calls = {"n": 0}

    async def fake(prompt, schema, temperature=0.0):
        calls["n"] += 1
        if calls["n"] == 1:
            raise LLMError("OpenRouter refused this request (flagged).")
        return {"text": "I arrive ___ 6 pm.", "options": ["at", "on"], "answer": "at"}

    monkeypatch.setattr(gen, "generate_json", fake)
    out = await gen.generate_exercise(topic="prepositions", ex_type="multiple-choice", level="A2")
    assert out["type"] == "multiple-choice"  # the learner never saw the blip
    assert calls["n"] == 2


async def test_all_attempts_failing_surfaces_the_provider_reason(monkeypatch):
    calls = {"n": 0}

    async def fake(prompt, schema, temperature=0.0):
        calls["n"] += 1
        raise LLMError("OpenRouter refused this request (moderation).")

    monkeypatch.setattr(gen, "generate_json", fake)
    with pytest.raises(LLMError, match="refused this request"):  # not the generic "unusable" line
        await gen.generate_exercise(topic="prepositions", ex_type="match-pairs", level="A2")
    assert calls["n"] == 5  # 3 attempts + 2 fallback — same budget as validation rejects


async def test_a_timeout_reraises_immediately(monkeypatch):
    calls = {"n": 0}

    async def fake(prompt, schema, temperature=0.0):
        calls["n"] += 1
        raise LLMTimeoutError("The OpenRouter API timed out.")

    monkeypatch.setattr(gen, "generate_json", fake)
    with pytest.raises(LLMTimeoutError):
        await gen.generate_exercise(topic="prepositions", ex_type="multiple-choice", level="A2")
    assert calls["n"] == 1  # each retry would stack another full timeout window — never retried
