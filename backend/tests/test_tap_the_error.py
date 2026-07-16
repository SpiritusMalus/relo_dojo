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


async def test_rejects_noop_correction(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json({"sentence": "He runs the tests daily now.", "wrong_word": "daily", "correction": "daily"}),
    )
    assert await gen._gen_tap_the_error("adverbs", level="B1") is None
