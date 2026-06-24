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
    # Tiles are the shuffled target words; the sealed token carries the target sentence.
    assert sorted(out["tiles"]) == sorted("She did not call me.".split())
    assert tokens.unseal(out["token"]) == {"t": "transform-the-sentence", "sentence": "She did not call me."}


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
