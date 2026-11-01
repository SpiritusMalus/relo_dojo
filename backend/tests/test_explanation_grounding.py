"""Explanation prompts retain visible evidence and distinguish classification from grammar faults."""
import json

import pytest

from app.services import _grammar_feedback as feedback, grammar


CONTEXT = (
    "Type: odd-one-out. Topic: word order. Tap the one that doesn't belong.\n"
    "Options: Always we deploy | Seldom do we | Rarely can they | Little did anyone"
)


@pytest.mark.parametrize("lang,language", [("ru", "Russian"), ("en", "English")])
async def test_structured_explanation_receives_all_options_and_classification_guard(monkeypatch, lang, language):
    async def fake(prompt, schema, **kwargs):
        assert kwargs["tier"] == "smart"
        assert CONTEXT in prompt
        assert language in prompt
        assert "ALL options are grammatical" in prompt
        assert "do not normalize or rewrite an option" in prompt
        assert "acknowledge that limit" in prompt
        assert "negative/restrictive" in prompt
        return {"explanation": "synthetic explanation", "tip": "synthetic tip"}
    monkeypatch.setattr(feedback, "generate_json", fake)
    assert await feedback.explain(CONTEXT, "Always we deploy", "Seldom do we", lang=lang) == {
        "explanation": "synthetic explanation", "tip": "synthetic tip",
    }


@pytest.mark.parametrize("lang", ["ru", "en"])
def test_stream_explanation_has_the_same_evidence_and_grounding(lang):
    prompt = feedback.explain_text_prompt(CONTEXT, "Always we deploy", "Seldom do we", lang=lang)
    assert CONTEXT in prompt
    assert feedback.EXPLANATION_GROUNDING in prompt
    assert "Plain prose only" in prompt


async def test_plain_answer_checker_keeps_the_base_tier(monkeypatch):
    async def fake(prompt, schema, **kwargs):
        assert kwargs.get("tier", "fast") == "fast"
        return {"correct": True, "correct_answer": "works", "explanation": "synthetic", "tip": ""}
    monkeypatch.setattr(feedback, "generate_json", fake)
    assert (await feedback.check_answer("She ___ here.", "works"))["correct"] is True


@pytest.mark.parametrize("lang,tip", [
    ("ru", "Продолжи упражнением с полным предложением."),
    ("en", "Continue with a complete-sentence exercise."),
])
async def test_legacy_word_order_classification_returns_authored_note_without_model(monkeypatch, lang, tip):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Legacy classification must not invoke a provider")
    monkeypatch.setattr(feedback, "generate_json", forbidden)
    context = json.dumps({"type": "odd-one-out", "topic": "word order", "options": ["arbitrary", "phrases"]})
    note = await feedback.explain(context, "arbitrary", "phrases", lang=lang)
    assert note == grammar.explanation_context_fallback(context, lang)
    assert note["tip"] == tip
    assert ("правило группировки" if lang == "ru" else "grouping rule") in note["explanation"]


@pytest.mark.parametrize("kind,topic", [("odd-one-out", "vocabulary"), ("multiple-choice", "word order")])
async def test_other_explicit_contexts_still_reach_smart_explanation(monkeypatch, kind, topic):
    calls = []
    context = json.dumps({"type": kind, "topic": topic, "text": "synthetic", "options": ["one", "two"]})
    async def fake(prompt, schema, **kwargs):
        calls.append(kwargs["tier"])
        assert context in prompt
        return {"explanation": "synthetic", "tip": "synthetic"}
    monkeypatch.setattr(feedback, "generate_json", fake)
    assert feedback.explanation_context_fallback(context) is None
    assert await feedback.explain(context, "one", "two") == {"explanation": "synthetic", "tip": "synthetic"}
    assert calls == ["smart"]


@pytest.mark.parametrize("text", ["Tap the one that does not belong", "not json", "[]", "null", "{}",
    '{"type":"odd-one-out","topic":"Word order"}', '{"type":"multiple-choice","topic":"word order"}'])
def test_legacy_guard_requires_exact_json_type_and_topic(text):
    assert grammar.explanation_context_fallback(text) is None
