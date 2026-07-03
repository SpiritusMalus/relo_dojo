"""transform-the-sentence generator: a new production type (rewrite a source per a grammar
instruction). Deterministic by design — graded by word position like build-the-sentence. These pin
the generator's validation window (no-op transform, missing parts, over-cap target all reject)."""

from app.services import _grammar_generators as gen
from app.services import tokens


def _fake_json(payload):
    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


async def test_accepts_a_clean_transform(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"instruction": "Make it negative", "source": "She called me.", "target": "She did not call me."}),
    )
    out = await gen._gen_transform_the_sentence("verb tenses", level="B1")
    assert out is not None
    assert out["type"] == "transform-the-sentence"
    assert out["instruction"] == "Make it negative"
    assert out["prompt"] == "She called me."
    # Tiles are the shuffled target words; the sealed token carries the target sentence (+ the
    # topic, which /check feeds to the server-side miss log on a wrong answer).
    assert sorted(out["tiles"]) == sorted("She did not call me.".split())
    assert tokens.unseal(out["token"]) == {
        "t": "transform-the-sentence",
        "sentence": "She did not call me.",
        "topic": "verb tenses",
    }


async def test_transform_banks_the_dropped_word_as_a_trap(monkeypatch):
    # A substitution transform ("fix the preposition") MUST put the discarded source word in the
    # bank — with only the corrected word among the tiles, the card arrives pre-solved (prod
    # screenshot 2026-07-03: "on 10 am" → bank held only "at", nothing to decide).
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({
            "instruction": "Исправьте предлог времени в предложении.",
            "source": "We have the sprint planning on 10 am.",
            "target": "We have the sprint planning at 10 am.",
        }),
    )
    out = await gen._gen_transform_the_sentence("prepositions", level="A2")
    assert out is not None
    assert out["distractors"] == ["on"]  # the trap the learner must NOT pick
    assert sorted(out["tiles"]) == sorted("We have the sprint planning at 10 am.".split())


async def test_transform_traps_strip_punctuation_and_skip_target_words(monkeypatch):
    # "works." (source-final) → trap "works" (bare tile); words that survive into the target
    # ("She", "here") never become traps.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({
            "instruction": "Make it negative",
            "source": "She works here.",
            "target": "She does not work here.",
        }),
    )
    out = await gen._gen_transform_the_sentence("verb tenses", level="B1")
    assert out is not None
    assert out["distractors"] == ["works"]


async def test_reorder_only_transform_has_no_traps(monkeypatch):
    # Every source word survives into the target (a pure reorder) → nothing to trap with; the
    # ordering itself is the task, so an empty list is fine (and old-payload clients see no change).
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"instruction": "Turn it into a question", "source": "You are ready.", "target": "Are you ready?"}),
    )
    out = await gen._gen_transform_the_sentence("word order", level="A2")
    assert out is not None
    assert out["distractors"] == []


def test_trap_tiles_filters_duplicates_junk_and_caps():
    words = "We have the sprint planning at 10 am.".split()
    assert gen._trap_tiles(["on", "AT", "on", "", "in the very early morning", "in"], words, cap=2) == ["on", "in"]
    # "AT" duplicates a sentence word (case/punctuation-insensitive) → dropped; long phrases dropped.


async def test_build_keeps_validated_model_traps(monkeypatch):
    # build-the-sentence traps come from the model (wrong forms); anything that already occurs in
    # the sentence is filtered out so the bank never holds confusing duplicates.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({
            "sentence_en": "She goes to work by bus.",
            "sentence_ru": "Она ездит на работу на автобусе.",
            "distractors": ["go", "goes", "busses"],
        }),
    )
    out = await gen._gen_build_the_sentence("verb tenses", level="A2")
    assert out is not None
    assert out["distractors"] == ["go", "busses"]  # "goes" is already a tile → dropped


async def test_rejects_noop_transform(monkeypatch):
    # target == source (after normalization) → nothing to do → reject.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"instruction": "Rewrite it", "source": "She called me.", "target": " she CALLED me. "}),
    )
    assert await gen._gen_transform_the_sentence("verb tenses", level="B1") is None


async def test_rejects_missing_parts(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"instruction": "", "source": "She called me.", "target": "She did not call me."}),
    )
    assert await gen._gen_transform_the_sentence("verb tenses", level="B1") is None


async def test_rejects_over_cap_target(monkeypatch):
    # A2 word cap is small; a long target overflows it → reject (caller falls back to another type).
    long_target = " ".join(["word"] * 30) + "."
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"instruction": "Expand it", "source": "Hi.", "target": long_target}),
    )
    assert await gen._gen_transform_the_sentence("verb tenses", level="A2") is None


def _capture_json(payload):
    """generate_json stand-in that records the prompt it was called with (for asserting on it)."""
    seen = {}

    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        seen["prompt"] = prompt
        return payload

    return _fake, seen


async def test_instruction_language_follows_lang(monkeypatch):
    # The learner-facing 'instruction' is the only prose on a transform card, so it follows the UI
    # language; the English source/target are unaffected (it's an English course).
    payload = {"instruction": "Сделай отрицательным", "source": "She called me.", "target": "She did not call me."}
    fake, seen = _capture_json(payload)
    monkeypatch.setattr(gen, "generate_json", fake)

    out = await gen._gen_transform_the_sentence("verb tenses", level="B1", lang="ru")
    assert out is not None
    assert "in Russian" in seen["prompt"]  # the prompt asks for a Russian instruction
    assert out["prompt"] == "She called me."  # source sentence stays English


async def test_instruction_language_defaults_to_english(monkeypatch):
    # No lang (back-compat: old client / story without lang) → English instruction, as before.
    fake, seen = _capture_json(
        {"instruction": "Make it negative", "source": "She called me.", "target": "She did not call me."}
    )
    monkeypatch.setattr(gen, "generate_json", fake)

    out = await gen._gen_transform_the_sentence("verb tenses", level="B1")
    assert out is not None
    assert "in English" in seen["prompt"]
    assert "in Russian" not in seen["prompt"]
