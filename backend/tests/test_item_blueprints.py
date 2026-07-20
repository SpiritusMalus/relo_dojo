"""Key-first construction: the answer is computed by our rule, so these tests ARE the correctness
guarantee for prepositions/articles — no LLM involved, nothing to hallucinate."""

from app.services import _item_blueprints as bp
from app.services import _grammar_generators as gen
from app.services import tokens


def _frame(topic, phrase, answer, distractors, cue):
    return bp.Blueprint(topic, phrase, answer, distractors, cue, "rule", "ask")


# --- articles: decided by sound, not spelling --------------------------------


def test_article_follows_the_sound_not_the_letter():
    assert bp.article_for("hour") == "an"  # consonant letter, vowel sound
    assert bp.article_for("honest") == "an"
    assert bp.article_for("university") == "a"  # vowel letter, consonant sound
    assert bp.article_for("useful") == "a"
    assert bp.article_for("umbrella") == "an"  # vowel letter, vowel sound
    assert bp.article_for("server") == "a"
    assert bp.article_for("Engineer.") == "an"  # case- and punctuation-insensitive


def test_article_slot_rejects_a_sentence_that_broke_the_rule():
    frame = _frame("articles", "an hour", "an", ("a",), "article")
    assert bp.build(frame, "The nurse waited an hour before the ward calmed down.") is not None
    # Model drifted to the wrong article — our rule disagrees, so there is no provable slot.
    assert bp.build(frame, "The nurse waited a hour before the ward calmed down.") is None


# --- prepositions of time ----------------------------------------------------


def test_day_frame_accepts_only_the_proven_slot():
    frame = _frame("prepositions", "on Monday", "on", ("in", "at"), "day")
    item = bp.build(frame, "The team ships the release on Monday every second week.")
    assert item is not None
    assert item.sentence[item.index] == "on"
    assert bp.build(frame, "The team ships the release in Monday every second week.") is None


def test_clock_frame_does_not_mistake_a_duration_for_a_time():
    # "in 6 hours" is correct English; only a real clock time proves 'at'.
    frame = _frame("prepositions", "at 6 pm", "at", ("in", "on"), "clock")
    assert bp.build(frame, "The backup starts at 6 pm on the main server.") is not None
    assert bp.build(frame, "The nurse finishes the shift at 6 hours from now.") is None


def test_month_frame_refuses_when_a_date_flips_the_rule():
    # "in May" takes 'in', but "on May 5" takes 'on' — an unprovable slot must not ship.
    frame = _frame("prepositions", "in May", "in", ("on", "at"), "month")
    assert bp.build(frame, "The audit happened in May and nobody noticed.") is not None
    assert bp.build(frame, "The audit happened in May 5 last year.") is None


def test_daypart_frame_refuses_the_contexts_that_flip_it():
    frame = _frame("prepositions", "in the morning", "in", ("on", "at"), "daypart")
    assert bp.build(frame, "She reviews the logs in the morning before standup.") is not None
    # "on the morning OF the launch" is correct — the rule no longer decides.
    assert bp.build(frame, "She reviews the logs in the morning of the launch.") is None
    # "on Monday morning" is correct too.
    assert bp.build(frame, "She reviews the logs Monday in the morning.") is None


def test_ambiguous_and_edge_slots_are_refused():
    frame = _frame("prepositions", "on Monday", "on", ("in", "at"), "day")
    # Two provable slots = two right taps.
    assert bp.build(frame, "We deploy on Monday and we test on Tuesday.") is None
    # Frame missing entirely.
    assert bp.build(frame, "We deploy every second week without fail.") is None
    # Sentence-initial slot would render a lowercase option against a capitalized original.
    assert bp.build(frame, "On Monday the team ships the release.") is None


def test_planted_error_needs_a_distractor_that_is_not_already_present():
    frame = _frame("prepositions", "on Monday", "on", ("in", "at"), "day")
    item = bp.build(frame, "The standup runs on Monday in the small room.")
    assert item is not None
    # 'in' already sits in the sentence — planting it would leave two identical wrong-looking tiles.
    assert bp.wrong_word_for(item) == "at"
    solo = bp.build(frame, "The standup runs on Monday with the whole team.")
    assert bp.wrong_word_for(solo) in ("in", "at")


def test_every_shipped_blueprint_proves_its_own_phrase():
    # Each frame we can hand to the model must validate a sentence built from that very phrase —
    # otherwise the generator would reject every attempt and burn the retry ladder.
    for topic in sorted(bp.BLUEPRINT_TOPICS):
        for _ in range(40):
            frame = bp.pick(topic)
            assert frame is not None
            assert bp.build(frame, f"The team noted the change {frame.phrase} without any fuss.") is not None


# --- wiring: the generator uses the proven key, never the model's opinion -----


def _fake_json(payload):
    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


async def test_blueprint_topic_routes_away_from_the_model_authored_generator():
    assert gen._generator_for("prepositions", "multiple-choice") is not gen._gen_multiple_choice
    assert gen._generator_for("prepositions", "tap-the-error") is not gen._gen_tap_the_error
    # Topics without a decidable canon keep the model-authored path.
    assert gen._generator_for("conditionals", "multiple-choice") is gen._gen_multiple_choice


async def test_blank_rendering_seals_the_computed_answer(monkeypatch):
    monkeypatch.setattr(gen.blueprints, "pick", lambda topic: _frame("prepositions", "on Friday", "on", ("in", "at"), "day"))
    monkeypatch.setattr(gen, "generate_json", _fake_json({"sentence": "The team ships the release on Friday every week."}))
    out = await gen._gen_from_blueprint("prepositions", level="B1", ex_type="multiple-choice")
    assert out is not None
    assert out["text"] == "The team ships the release ___ Friday every week."
    assert set(out["options"]) == {"on", "in", "at"}
    assert tokens.unseal(out["token"])["answer"] == "on"


async def test_planted_error_rendering_is_a_real_single_word_substitution(monkeypatch):
    monkeypatch.setattr(gen.blueprints, "pick", lambda topic: _frame("prepositions", "on Friday", "on", ("in", "at"), "day"))
    monkeypatch.setattr(gen, "generate_json", _fake_json({"sentence": "The team ships the release on Friday every week."}))
    out = await gen._gen_from_blueprint("prepositions", level="B1", ex_type="tap-the-error")
    assert out is not None
    sealed = tokens.unseal(out["token"])
    planted = out["tokens"][sealed["index"]]
    assert planted in ("in", "at")  # the proven-wrong word sits in the proven slot
    assert sealed["answer"] == f"'{planted}' → 'on'"
    assert out["tokens"].count(planted) == 1  # exactly one tile can be the right tap


async def test_a_sentence_that_ignores_the_frame_is_rejected(monkeypatch):
    monkeypatch.setattr(gen.blueprints, "pick", lambda topic: _frame("prepositions", "on Friday", "on", ("in", "at"), "day"))
    monkeypatch.setattr(gen, "generate_json", _fake_json({"sentence": "The team ships the release every single week."}))
    assert await gen._gen_from_blueprint("prepositions", level="B1", ex_type="multiple-choice") is None
