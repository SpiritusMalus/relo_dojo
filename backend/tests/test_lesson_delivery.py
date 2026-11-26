"""Regression checks for exercise contracts, cancellation and authored story context."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app import main
from app.core.config import settings
from app.schemas import CheckIn, ExerciseIn, ReviewExerciseTokenIn, StoryIn
from app.services import _grammar_generators as gen, tokens
from app.services.curated_fallback import build_fallback
from app.services.llm import LLMRefusedError


def fake_item(topic="word order"):
    return {"type": "build-the-sentence", "topic": topic, "level": "A2", "text": "Translate into English:",
            "prompt": "Где станция?", "tiles": ["station?", "is", "the", "Where"],
            "token": tokens.seal({"t": "build-the-sentence", "sentence": "Where is the station?", "topic": topic})}


async def test_assessment_never_delivers_a_different_format_or_band(monkeypatch):
    monkeypatch.setitem(gen._GENERATORS, "build-the-sentence", AsyncMock(return_value={
        "level": "B1", "topic": "word order", "type": "multiple-choice",
    }))
    with pytest.raises(gen.AssessmentUnavailable):
        await gen.generate_exercise("word order", "C1", "build-the-sentence", assessment=True)


async def test_eligible_timeout_uses_exact_assessment_or_practice_bank(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    monkeypatch.setattr(settings, "EXERCISE_TIMEOUT_S", 0.005)

    async def too_slow(*args, **kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(gen, "generate_json", too_slow)
    exact = await gen.generate_exercise("word order", "A2", "build-the-sentence", assessment=True)
    assert (exact["type"], exact["level"], exact["source"], exact["evidence_kind"]) == (
        "build-the-sentence", "A2", "curated", "topic")
    ordinary = await gen.generate_exercise("word order", "C1", "build-the-sentence")
    assert (ordinary["type"], ordinary["level"], ordinary["source"]) == ("multiple-choice", "B1", "curated")
    with pytest.raises(gen.AssessmentUnavailable):
        await gen.generate_exercise("articles", "C1", "match-pairs", assessment=True)


async def test_explicit_refusal_does_not_use_assessment_fallback(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    monkeypatch.setattr(gen, "generate_json", AsyncMock(side_effect=LLMRefusedError("Provider refusal")))
    with pytest.raises(LLMRefusedError):
        await gen.generate_exercise("word order", "A2", "build-the-sentence", assessment=True)


def test_curated_practice_rotates_and_assessment_can_keep_a2_punctuation_format():
    assert build_fallback("word order", "A2", 0)["text"] != build_fallback("word order", "A2", 1)["text"]
    card = build_fallback("punctuation", "A2", 0, exact_type="tap-the-error")
    assert card and (card["type"], card["level"]) == ("tap-the-error", "A2")
    assert tokens.unseal(card["token"])["answer"] == "'raining.' → 'raining,'"


async def test_assessment_payload_drops_historical_misses(monkeypatch):
    user = SimpleNamespace(id="fixture-user", pd_consent_at=True)
    monkeypatch.setattr(main.gating, "ensure_daily_quota", lambda user: None)
    monkeypatch.setattr(main.gating, "consume_daily_exercise", AsyncMock())
    monkeypatch.setattr(main.miss_log, "recent_misses", AsyncMock(side_effect=AssertionError("history read")))
    monkeypatch.setattr(main.learner_profile, "get_data", AsyncMock(side_effect=AssertionError("profile read")))
    generate = AsyncMock(return_value=fake_item())
    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    result = await main.exercise(ExerciseIn(
        topic="word order", level="A2", type="build-the-sentence", assessment=True, mistakes=["old answer"],
    ), user=user, db=object())
    assert generate.await_args.kwargs["assessment"] is True
    assert generate.await_args.kwargs["mistakes"] == []
    assert result.review_token and result.learning_bound is False


async def test_disconnected_exercise_cancels_generation_before_quota(monkeypatch):
    disconnected = asyncio.Event()
    started = asyncio.Event()
    finished = asyncio.Event()

    async def is_disconnected():
        return disconnected.is_set()

    async def generate(**kwargs):
        started.set()
        try:
            await asyncio.sleep(10)
        finally:
            finished.set()

    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    consume = AsyncMock()
    monkeypatch.setattr(main.gating, "consume_daily_exercise", consume)
    request = SimpleNamespace(is_disconnected=is_disconnected)
    task = asyncio.create_task(main.exercise(ExerciseIn(), user=None, db=object(), request=request))
    await asyncio.wait_for(started.wait(), 1)
    disconnected.set()
    with pytest.raises(HTTPException) as raised:
        await asyncio.wait_for(task, 2)
    assert raised.value.status_code == 499 and finished.is_set()
    consume.assert_not_awaited()


async def test_story_preserves_scene_and_unique_beat_in_each_prompt(monkeypatch):
    seen = []

    async def generate(topic, context, **kwargs):
        seen.append(context)
        return fake_item(topic)

    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    out = await main.story(StoryIn(id="missing-bag", level="A2", context="works with computers"), user=None)
    assert len(out.beats) == len(set(seen)) == 3
    assert all("lost suitcase" in context and "works with computers" in context for context in seen)
    assert set(beat.narration for beat in out.beats) <= {context.split("Current beat: ")[1].split(" Learner background")[0] for context in seen}


async def test_random_story_picker_receives_only_available_ids(monkeypatch):
    def choose(pool):
        assert all(main.stories.is_available(main.stories._BY_ID[id], set()) for id in pool)
        return pool[0]

    monkeypatch.setattr(main.random, "choice", choose)
    story = AsyncMock(return_value={"id": "moving-day", "title": "The big move", "beats": []})
    monkeypatch.setattr(main.stories, "build_story", story)
    await main.story(StoryIn(), user=None)
    assert story.await_args.kwargs["scenario_id"] in main.stories.FREE_IDS


async def test_punctuation_tap_token_can_change_only_a_mark(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", AsyncMock(return_value={
        "sentence": "After lunch. we went home.", "wrong_word": "lunch.", "correction": "lunch,",
    }))
    card = await gen._gen_tap_the_error("punctuation", "A2")
    assert card and tokens.unseal(card["token"])["answer"] == "'lunch.' → 'lunch,'"


async def test_odd_card_shows_criterion_and_seals_its_reason(monkeypatch):
    reason = "A table is furniture."
    rule = "Select the item that is not a fruit."
    monkeypatch.setattr(gen, "generate_json", AsyncMock(return_value={
        "items": ["pear", "apple", "banana", "table"], "odd": "table", "criterion": rule, "reason": reason,
    }))
    card = await gen._gen_odd_one_out("vocabulary", "A1", lang="en")
    assert card and card["instruction"] == rule and reason not in card.values()
    assert tokens.unseal(card["token"])["reason"] == reason


def test_shuffle_cannot_leave_the_given_order(monkeypatch):
    monkeypatch.setattr(gen.random, "shuffle", lambda tiles: None)
    tiles = ["We", "check", "We"]
    assert gen._shuffled_tiles(tiles) != tiles
    assert sorted(gen._shuffled_tiles(tiles)) == sorted(tiles)


async def test_story_cancels_remaining_work_after_failed_beat(monkeypatch):
    siblings_started = asyncio.Event()
    sibling_count = 0
    cancelled = []

    async def generate(topic, **kwargs):
        nonlocal sibling_count
        if topic == "articles":
            await siblings_started.wait()
            raise gen.AssessmentUnavailable("First beat failed")
        sibling_count += 1
        if sibling_count == 2:
            siblings_started.set()
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(topic)

    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    with pytest.raises(HTTPException) as raised:
        await asyncio.wait_for(main.story(StoryIn(id="missing-bag", level="A2"), user=None), 2)
    assert raised.value.status_code == 503
    assert set(cancelled) == {"prepositions", "word order"}


async def test_single_sentence_listening_item_is_rejected(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", AsyncMock(return_value={
        "passage": "The speaker handed the green folder to the clerk before lunch.",
    }))
    assert await gen._gen_listen_retell("word order", "B1") is None


async def test_russian_transform_rejects_misnamed_grammatical_category(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", AsyncMock(return_value={
        "instruction": "Перепиши в третье условное наклонение.",
        "source": "If you call, I will answer.",
        "target": "If you had called, I would have answered.",
    }))
    assert await gen._gen_transform_the_sentence("conditionals", "B2", lang="ru") is None


async def test_scoped_review_renewal_keeps_study_out_of_wallet_and_miss_history(monkeypatch):
    request = SimpleNamespace(headers={"X-Relo-Review-Guest": "a-mzy3mqp0-tkj4n0v4qs"})
    card = fake_item()
    issued = tokens.attach_review_token(card, None, request.headers["X-Relo-Review-Guest"])
    response = await main.renew_review_exercise(
        ReviewExerciseTokenIn(token=issued["review_token"]), user=None, request=request,
    )
    award = AsyncMock(side_effect=AssertionError("study cannot award koku"))
    miss = AsyncMock(side_effect=AssertionError("study cannot rewrite ordinary miss history"))
    monkeypatch.setattr(main.wallet_service, "award_correct_check", award)
    monkeypatch.setattr(main.miss_log, "record_miss", miss)
    checked = await main.check(CheckIn(token=response.review_token, response="Where is the station?"),
                              user=None, db=object(), request=request)
    assert checked.correct and checked.coins_earned == 0
    with pytest.raises(HTTPException) as failure:
        await main.renew_review_exercise(ReviewExerciseTokenIn(token=card["token"]), user=None, request=request)
    assert failure.value.status_code == 400 and failure.value.detail["code"] == "review_unrecoverable"


async def test_partial_story_retries_only_the_failed_beat_over_the_api(monkeypatch):
    seen = []

    async def generate(topic, level, ex_type, context, lang):
        seen.append((topic, level, ex_type, context, lang))
        if topic == "prepositions" and sum(call[0] == topic for call in seen) == 1:
            raise gen.OllamaError("Temporary provider failure")
        return fake_item(topic)

    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    guest = {"X-Relo-Review-Guest": "a-fixtureone-84rp5lzs"}
    another = {"X-Relo-Review-Guest": "a-fixturetwo-84rp5lzs"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://qa.test") as client:
        response = await client.post("/story", json={
            "id": "missing-bag", "level": "A2", "context": "works at a hotel", "lang": "ru", "allow_partial": True,
        }, headers=guest)
        assert response.status_code == 200, response.text
        story = response.json()
        first, middle, last = story["beats"]
        assert first["exercise"]["token"] and last["exercise"]["token"]
        assert middle["exercise"] is None and middle["narration"]
        retry = {"resume_token": story["resume_token"], "index": 1}
        assert (await client.post("/story/beat", json=retry, headers=another)).status_code == 403
        assert (await client.post("/story/beat", json={**retry, "index": 0}, headers=guest)).status_code == 409
        assert len(seen) == 3
        replaced = await client.post("/story/beat", json=retry, headers=guest)
        assert replaced.status_code == 200, replaced.text
        assert replaced.json()["topic"] == "prepositions"
        assert replaced.json()["review_token"]
        assert len(seen) == 4
        first_attempt = next(call for call in seen if call[0] == "prepositions")
        assert seen[-1] == first_attempt
        assert middle["narration"] in seen[-1][3]


async def test_story_resume_rechecks_locked_arc_before_provider(monkeypatch):
    import uuid
    from app.schemas import StoryBeatIn

    async def generate(topic, level, ex_type, context, lang):
        raise gen.OllamaError("Temporary provider failure")

    async def connected():
        return False

    user_id = uuid.uuid4()
    buyer = SimpleNamespace(id=user_id, unlocks=["arc_detective"])
    request = SimpleNamespace(headers={}, is_disconnected=connected)
    monkeypatch.setattr(main.grammar, "generate_exercise", generate)
    story = await main.story(StoryIn(id="midnight-detective", level="A2", allow_partial=True),
                             user=buyer, request=request)
    assert all(beat.exercise is None for beat in story.beats)
    buyer.unlocks.clear()
    generator = AsyncMock(side_effect=AssertionError("locked arc must not reach the provider"))
    monkeypatch.setattr(main.grammar, "generate_exercise", generator)
    with pytest.raises(HTTPException) as error:
        await main.story_beat(StoryBeatIn(resume_token=story.resume_token, index=0), user=buyer, request=request)
    assert error.value.status_code == 403
    generator.assert_not_awaited()


async def test_english_sentence_build_uses_a_cue_and_keeps_the_answer_sealed(monkeypatch):
    cue = "Ask whether the other person looks at the records every time."
    sentence = "Do you always check the logs?"
    generate = AsyncMock(return_value={"sentence_en": sentence, "cue_en": cue})
    monkeypatch.setattr(gen, "generate_json", generate)
    card = await gen._gen_build_the_sentence("word order", "A2", lang="en")
    assert generate.await_args.args[1] is gen.BUILD_CUE_SCHEMA
    assert "different words" in generate.await_args.args[0]
    assert card["prompt"] == cue and card["instruction"] == gen.BUILD_CUE_INSTRUCTION
    assert all(sentence not in card[field] for field in ("text", "prompt", "instruction"))
    assert tokens.unseal(card["token"])["sentence"] == sentence


@pytest.mark.parametrize("cue", [
    "", "Ты всегда проверяешь журналы?", 'Write: “DO YOU always check the logs!”',
    "Ask: Do you always check the records?",
])
async def test_english_sentence_build_rejects_an_unusable_or_answer_revealing_cue(monkeypatch, cue):
    monkeypatch.setattr(gen, "generate_json", AsyncMock(return_value={
        "sentence_en": "Do you always check the logs?", "cue_en": cue,
    }))
    assert await gen._gen_build_the_sentence("word order", "A2", lang="en") is None


@pytest.mark.parametrize("lang", ["ru", None])
async def test_russian_sentence_build_keeps_the_legacy_source(monkeypatch, lang):
    source = "Ты всегда проверяешь журналы?"
    generate = AsyncMock(return_value={"sentence_en": "Do you always check the logs?", "sentence_ru": source})
    monkeypatch.setattr(gen, "generate_json", generate)
    card = await gen._gen_build_the_sentence("word order", "A2", lang=lang)
    assert generate.await_args.args[1] is gen.BUILD_SCHEMA
    assert card["prompt"] == source and card["text"] == "Translate into English:"
    assert "instruction" not in card


@pytest.mark.parametrize("level", ["A1", "A2", "B1", "B2", "C1"])
@pytest.mark.parametrize("index", [0, 1])
def test_authored_english_cues_keep_all_exact_assessment_keys(level, index):
    english = build_fallback("word order", level, index, exact_type="build-the-sentence", lang="en")
    russian = build_fallback("word order", level, index, exact_type="build-the-sentence")
    assert english["level"] == russian["level"] == level
    assert english["type"] == russian["type"] == "build-the-sentence"
    key = tokens.unseal(english["token"])
    assert key == tokens.unseal(russian["token"])
    assert sorted(english["tiles"]) == sorted(russian["tiles"])
    assert english["prompt"].isascii() and russian["prompt"] != english["prompt"]
    assert key["sentence"].casefold() not in english["prompt"].casefold()
    assert english["instruction"] == gen.BUILD_CUE_INSTRUCTION


async def test_assessment_failure_falls_back_to_the_english_cue(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_CURATED_FALLBACK_ENABLED", True)
    monkeypatch.setattr(gen, "generate_json", AsyncMock(side_effect=gen.OllamaError("Temporary provider error")))
    card = await gen.generate_exercise(
        "word order", "A2", "build-the-sentence", lang="en", assessment=True, practice_index=0,
    )
    assert (card["type"], card["level"], card["source"]) == ("build-the-sentence", "A2", "curated")
    assert card["instruction"] == gen.BUILD_CUE_INSTRUCTION and card["prompt"].isascii()
