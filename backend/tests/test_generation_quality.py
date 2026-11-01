"""Regression gates for impossible choices, upstream schema drift and semantic retry/deny."""
from __future__ import annotations

import json
import asyncio

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.schemas import ProgressData
from app.services import _grammar_generators as gen, llm, tokens
from app.services._grammar_grading import grade


@pytest.mark.parametrize("text,options,answer", [
    ("She works here.", ["works", "work"], "works"),
    ("She ___ ___ here.", ["works", "work"], "works"),
    ("She ___ here.", ["works", " Works "], "works"),
    ("She ___ here.", ["work", "working"], "works"),
    ("She ___ here.", ["works", "work", "worked", "working", "worker"], "works"),
])
async def test_multiple_choice_cannot_serve_an_impossible_or_duplicate_choice(monkeypatch, text, options, answer):
    async def fake(*args, **kwargs):
        return {"text": text, "options": options, "answer": answer}
    monkeypatch.setattr(gen, "generate_json", fake)
    assert await gen._gen_multiple_choice("verb sequence (tense agreement)", "A1") is None


async def test_normalized_blank_and_visible_key_are_solvable(monkeypatch):
    async def fake(*args, **kwargs):
        return {"text": "She ____ here.", "options": ["works", "work"], "answer": "works"}
    monkeypatch.setattr(gen, "generate_json", fake)
    item = await gen._gen_multiple_choice("verb sequence (tense agreement)", "A1")
    assert item["text"] == "She ___ here."
    key = tokens.unseal(item["token"])
    assert key["answer"] in item["options"]
    assert grade(key, key["answer"])["correct"] is True


async def test_odd_item_cannot_be_hidden_by_truncation(monkeypatch):
    async def fake(*args, **kwargs):
        return {"items": ["run", "walk", "swim", "jump", "dance", "sing", "chair"],
                "odd": "chair", "reason": "It is not an action."}
    monkeypatch.setattr(gen, "generate_json", fake)
    assert await gen._gen_odd_one_out("vocabulary", "A1") is None


async def test_matching_rejects_a_left_tile_with_two_blanks(monkeypatch):
    async def fake(*args, **kwargs):
        return {"pairs": [{"left": "I ___ ___ home.", "right": "go"},
                          {"left": "She ___ home.", "right": "goes"},
                          {"left": "We ___ home.", "right": "went"}]}
    monkeypatch.setattr(gen, "generate_json", fake)
    assert await gen._gen_match_pairs("verb sequence (tense agreement)", "A1") is None


def test_native_strict_schema_is_recursive_and_preserves_optional_meaning():
    schema = {"type": "object", "properties": {
        "rows": {"type": "array", "items": {"type": "object", "properties": {
            "answer": {"type": "string"}, "note": {"type": "string"}}, "required": ["answer"]}}},
        "required": ["rows"]}
    original = json.dumps(schema, sort_keys=True)
    strict = llm.strict_json_schema(schema)
    child = strict["properties"]["rows"]["items"]
    assert strict["additionalProperties"] is False
    assert child["additionalProperties"] is False
    assert child["required"] == ["answer", "note"]
    assert child["properties"]["note"] == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert json.dumps(schema, sort_keys=True) == original  # never alter other provider schemas


@pytest.mark.parametrize("output", [None, [], "text", {},
    {"options": "not an array"}, {"options": [1]}, {"options": ["a"], "extra": 1}])
async def test_schema_ignoring_upstream_is_rejected_before_generators(monkeypatch, output):
    async def fake(*args, **kwargs):
        return output
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openrouter")
    monkeypatch.setattr(llm, "_openrouter", fake)
    schema = {"type": "object", "properties": {"options": {"type": "array", "items": {"type": "string"}}}, "required": ["options"]}
    with pytest.raises(llm.LLMError, match="schema"):
        await llm.generate_json("synthetic", schema)


async def test_semantic_rejection_repairs_key_before_serving(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REVIEW_ENABLED", True)
    generations, reviews, prompts = 0, 0, []
    async def fake(prompt, schema, **kwargs):
        nonlocal generations, reviews
        if schema is gen.REVIEW_SCHEMA:
            reviews += 1
            assert "token" not in prompt
            assert '"key"' in prompt and '"task"' in prompt
            return {"valid": reviews > 1, "reason": "The answer must be works for singular she."}
        generations += 1
        prompts.append(prompt)
        return {"text": "She ___ here.", "options": ["works", "work"],
                "answer": "work" if generations == 1 else "works"}
    monkeypatch.setattr(gen, "generate_json", fake)
    item = await gen.generate_exercise("verb sequence (tense agreement)", "A1", "multiple-choice")
    assert generations == reviews == 2
    assert "The answer must be works" in prompts[1]
    assert tokens.unseal(item["token"])["answer"] == "works"


async def test_repeated_semantic_rejections_never_serve_a_bad_card(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REVIEW_ENABLED", True)
    async def fake(prompt, schema, **kwargs):
        if schema is gen.REVIEW_SCHEMA:
            return {"valid": False, "reason": "Both modal options are acceptable."}
        return {"text": "She ___ work.", "options": ["can", "must"], "answer": "can"}
    monkeypatch.setattr(gen, "generate_json", fake)
    with pytest.raises(llm.LLMError, match="unusable"):
        await gen.generate_exercise("modal verbs", "A2", "multiple-choice")


async def test_proven_blueprint_key_still_reviews_model_authored_context(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REVIEW_ENABLED", True)
    item = {"type": "multiple-choice", "text": "I wait here for ___ hour now.", "options": ["a", "an"],
            "token": tokens.seal({"t": "multiple-choice", "answer": "an", "rule": "Vowel sounds take an."})}
    async def reviewer(prompt, *args, **kwargs):
        assert "I wait here for ___ hour now" in prompt
        return {"valid": False, "reason": "The present simple is wrong with an ongoing duration ending now."}
    monkeypatch.setattr(gen, "generate_json", reviewer)
    assert await gen._review_exercise(item, "A1") is None


def test_recent_adaptive_evidence_survives_sync_with_bounds():
    evidence = {"score": .5, "difficulty": 2.5, "format": "multiple-choice", "elapsedMs": 4200, "hintUsed": True}
    snapshot = ProgressData.model_validate({"topics": {"articles": {"attempts": 1, "recent": [evidence]}}})
    assert snapshot.model_dump()["topics"]["articles"]["recent"][0] == evidence
    with pytest.raises(ValidationError):
        ProgressData.model_validate({"topics": {"articles": {"recent": [evidence] * 7}}})
    with pytest.raises(ValidationError):
        ProgressData.model_validate({"topics": {"articles": {"recent": [{**evidence, "score": 2}]}}})


def test_openrouter_reasoning_model_drops_unsupported_temperature(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_REASONING_EFFORT", "low")
    payload = llm.with_openrouter_prefs(llm.build_openai_payload(
        "synthetic", {"type": "object"}, .7, model="openai/gpt-6-luna"))
    assert "temperature" not in payload
    assert payload["provider"]["require_parameters"] is True


@pytest.mark.parametrize("text,options", [
    ("She said she ___ happy.", ["is", "was", "will be"]),
    ("The manager claimed the team ___ the deadline.", ["will meet", "would meet", "meets"]),
])
def test_optional_backshift_never_proves_a_unique_answer(text, options):
    assert gen._ambiguous_backshift(text, options)


@pytest.mark.parametrize("level", ["B2", "C1"])
@pytest.mark.parametrize("topic", ["articles", "prepositions"])
def test_advanced_topics_do_not_relabel_basic_blueprints_as_advanced(topic, level):
    from app.services._grammar_prompts import _level_clause
    assert gen._generator_for(topic, "multiple-choice", level) is gen._gen_multiple_choice
    assert gen._generator_for(topic, "tap-the-error", level) is gen._gen_tap_the_error
    assert "tested decision itself" in _level_clause(level)


def test_invalid_level_is_normalized_before_prompt_and_scoring():
    from app.services._grammar_prompts import _cefr
    assert _cefr(" c1 ") == "C1"
    assert _cefr("C9") == "B1"


async def test_entire_generation_ladder_has_one_deadline(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_TIMEOUT_S", .005)
    async def slow(*args):
        await asyncio.sleep(1)
    monkeypatch.setattr(gen, "_generate_exercise", slow)
    with pytest.raises(llm.LLMTimeoutError, match="too long to validate"):
        await gen.generate_exercise("articles", "A1", "multiple-choice")


async def test_generic_policy_refusal_fails_fast_without_repeated_calls(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    calls = 0
    async def refused(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise llm.LLMRefusedError("Request blocked: PII detected (PERSON)")
    monkeypatch.setattr(gen, "generate_json", refused)
    with pytest.raises(llm.LLMRefusedError):
        await gen.generate_exercise("conditionals", "B1", "multiple-choice")
    assert calls == 1


async def test_exhausted_validation_has_one_stronger_checked_repair(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    tiers = []
    async def fake(prompt, schema, *, temperature=None, tier="fast"):
        tiers.append(tier)
        if tier == "repair":
            return {"text": "She ___ here.", "options": ["works", "work"], "answer": "works"}
        return {"text": "No blank.", "options": ["a", "b"], "answer": "a"}
    monkeypatch.setattr(gen, "generate_json", fake)
    item = await gen.generate_exercise("verb sequence (tense agreement)", "A1", "multiple-choice")
    assert tiers == ["fast", "fast", "fast", "repair"]
    assert grade(tokens.unseal(item["token"]), "works")["correct"] is True


async def test_repair_review_transport_error_cannot_serve_unreviewed_item(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_REVIEW_ENABLED", True)
    async def fake(prompt, schema, *, temperature=None, tier="fast"):
        if tier == "smart":
            raise llm.LLMError("Review unavailable")
        if tier == "repair":
            return {"text": "She ___ here.", "options": ["works", "work"], "answer": "works"}
        return {"text": "No blank.", "options": ["a", "b"], "answer": "a"}
    monkeypatch.setattr(gen, "generate_json", fake)
    with pytest.raises(llm.LLMError, match="Review unavailable"):
        await gen.generate_exercise("verb sequence (tense agreement)", "A1", "multiple-choice")


def test_repair_model_is_separate_from_generator_and_reviewer(monkeypatch):
    monkeypatch.setattr(settings, "OPENROUTER_MODEL_REPAIR", "google/gemini-3.8-flash")
    assert llm._model_for("openrouter", "repair") == "google/gemini-3.8-flash"


async def test_modal_choice_requires_visible_meaning_constraint(monkeypatch):
    async def fake(*args, **kwargs):
        return {"text": "You ___ run here.", "options": ["must", "can", "should"], "answer": "must"}
    monkeypatch.setattr(gen, "generate_json", fake)
    assert await gen._gen_multiple_choice("modal verbs", "A2") is None


async def test_curated_floor_preserves_actual_level_and_provenance(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    async def invalid(*args, **kwargs):
        return {"text": "No blank", "options": ["a", "b"], "answer": "a"}
    monkeypatch.setattr(gen, "generate_json", invalid)
    item = await gen.generate_exercise("conditionals", "C1", "multiple-choice", practice_index=7)
    assert item["source"] == "curated"
    assert item["level"] == "B2"  # no relabelling an authored B2 item as a generated C1 item
    assert grade(tokens.unseal(item["token"]), tokens.unseal(item["token"])["answer"])["correct"]


def test_practice_index_rotates_decision_and_replaces_frequency_anchor():
    from app.services._grammar_prompts import _practice_index, _tutor_intro
    from app.services._grammar_rules import GRAMMAR_RULES
    marker = _practice_index.set(1)
    try:
        first = _tutor_intro(level="A2", topic="word order")
        _practice_index.set(2)
        second = _tutor_intro(level="A2", topic="word order")
    finally:
        _practice_index.reset(marker)
    assert "yes/no questions" in first and "wh-questions" in second
    assert GRAMMAR_RULES["word order"] not in first
    assert first != second


def test_progress_format_window_and_practice_request_are_bounded():
    from app.schemas import ExerciseIn
    assert ExerciseIn(practice_index=3).practice_index == 3
    assert ProgressData(recentFormats=["multiple-choice", "match-pairs"]).model_dump()["recentFormats"] == ["multiple-choice", "match-pairs"]
    with pytest.raises(ValidationError):
        ExerciseIn(practice_index=-1)
    with pytest.raises(ValidationError):
        ProgressData(recentFormats=["a", "b", "c"])


async def test_malformed_model_output_reaches_repair_and_curated_floor(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    tiers = []
    async def malformed(*args, tier="fast", **kwargs):
        tiers.append(tier)
        raise llm.LLMOutputError("Model returned invalid JSON.")
    monkeypatch.setattr(gen, "generate_json", malformed)
    item = await gen.generate_exercise("word order", "B1", "multiple-choice")
    assert tiers == ["fast", "fast", "fast", "repair"]
    assert item["source"] == "curated"


@pytest.mark.parametrize("choice", [
    {"finish_reason": "content_filter", "message": {"content": None}},
    {"finish_reason": "stop", "message": {"content": None, "refusal": "Cannot comply"}},
])
async def test_explicit_model_refusal_never_becomes_output_repair_or_bank(monkeypatch, choice):
    monkeypatch.setattr(settings, "EXERCISE_REPAIR_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    calls = 0
    async def refused(*args, **kwargs):
        nonlocal calls
        calls += 1
        return llm.parse_openai_response({"choices": [choice]}, expect_json=True)
    monkeypatch.setattr(gen, "generate_json", refused)
    with pytest.raises(llm.LLMRefusedError):
        await gen.generate_exercise("word order", "A2", "multiple-choice")
    assert calls == 1


def test_invalid_json_and_schema_have_content_error_classification():
    with pytest.raises(llm.LLMOutputError):
        llm.parse_openai_response({"choices": [{"message": {"content": "{truncated"}}]}, True)
    with pytest.raises(llm.LLMOutputError):
        llm.validate_json_output({"answer": []}, {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]})
