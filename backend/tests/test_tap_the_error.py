"""tap-the-error must be a real single-word substitution. A correction that equals the wrong word,
or that already sits elsewhere in the sentence, produces a broken item (e.g. "...update frequently
usually..." with 'frequently'→'usually', where 'usually' is already present). Pin those rejections."""

from app.services import _grammar_generators as gen
from app.services import tokens


def _fake_json(payload):
    """Return an async stand-in for llm.generate_json that yields a fixed structured payload."""

    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


async def test_accepts_clean_substitution(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"sentence": "She goed to the office yesterday.", "wrong_word": "goed", "correction": "went"}),
    )
    out = await gen._gen_tap_the_error("verbs", level="B1")
    assert out is not None
    assert out["type"] == "tap-the-error"
    sealed = tokens.unseal(out["token"])
    assert out["tokens"][sealed["index"]] == "goed"
    assert sealed["answer"] == "'goed' → 'went'"


async def test_rejects_correction_already_in_sentence(monkeypatch):
    # The exact prod defect: both the wrong word and its "fix" appear, so correcting yields a duplicate.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "sentence": "The server logs update frequently usually during the nightly window.",
                "wrong_word": "frequently",
                "correction": "usually",
            }
        ),
    )
    assert await gen._gen_tap_the_error("word order", level="B1") is None


async def test_rejects_word_order_error_dressed_as_a_substitution(monkeypatch):
    # Prod 2026-07-19: a misplaced adverb shipped as 'walks'→'always walks'. The card can only swap
    # ONE tapped word for ONE word, so the learner who taps the actually-misplaced 'always' is marked
    # wrong, and applying the stored fix would duplicate it.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "sentence": "The tired nurse walks always to the busy ward at night.",
                "wrong_word": "walks",
                "correction": "always walks",
            }
        ),
    )
    assert await gen._gen_tap_the_error("word order", level="B1") is None


async def test_rejects_wrong_word_appearing_twice(monkeypatch):
    # Two identical tiles = no single right tile to tap; the sealed index would be a coin flip.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "sentence": "The team meets in Monday and in Friday every week.",
                "wrong_word": "in",
                "correction": "on",
            }
        ),
    )
    assert await gen._gen_tap_the_error("prepositions", level="B1") is None


async def test_rejects_noop_correction(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"sentence": "He runs the tests daily now.", "wrong_word": "daily", "correction": "daily"}),
    )
    assert await gen._gen_tap_the_error("adverbs", level="B1") is None


async def test_single_preposition_transform_becomes_gap_fill(monkeypatch):
    # A one-word closed-class swap (in→on) should render as a focused single-blank multiple-choice,
    # not a full sentence rebuild.
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "instruction": "Fix the time preposition",
                "source": "The meeting is at 2 pm in Tuesday.",
                "target": "The meeting is at 2 pm on Tuesday.",
            }
        ),
    )
    out = await gen._gen_transform_the_sentence("prepositions", level="B1")
    assert out is not None
    assert out["type"] == "multiple-choice"
    assert out["text"] == "The meeting is at 2 pm ___ Tuesday."
    assert "on" in out["options"] and "in" in out["options"]
    assert tokens.unseal(out["token"])["answer"] == "on"


async def test_multiword_transform_stays_a_builder(monkeypatch):
    # A tense change touches several tokens → keep the tile-builder (transform-the-sentence).
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "instruction": "Rewrite in the past simple",
                "source": "She writes the report today.",
                "target": "She wrote the report yesterday.",
            }
        ),
    )
    out = await gen._gen_transform_the_sentence("verbs", level="B1")
    assert out is not None
    assert out["type"] == "transform-the-sentence"
