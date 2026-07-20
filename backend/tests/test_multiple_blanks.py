"""multiple-blanks must ask a decidable question at every blank. Prod 2026-07-19 shipped
"The developer ___ fixes the ___ ___ bug in production." with often/always and code/server —
two of the three blanks had no knowable answer, so the learner was graded on a coin flip."""

from app.services import _grammar_generators as gen
from app.services import tokens


def _fake_json(payload):
    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


def test_exclusive_blank_accepts_one_real_decision():
    assert gen._exclusive_blank(["fix", "fixes"])  # forms of the same verb
    assert gen._exclusive_blank(["in", "on", "at"])  # one closed class
    assert gen._exclusive_blank(["was", "were"])
    assert gen._exclusive_blank(["go", "went"])  # irregular family, no shared stem
    assert gen._exclusive_blank(["can", "must"])  # modals
    assert gen._exclusive_blank(["scary large", "large scary"])  # word order IS the question


def test_exclusive_blank_rejects_interchangeable_words():
    assert not gen._exclusive_blank(["often", "always"])  # both fit — coin flip
    assert not gen._exclusive_blank(["code", "server"])
    assert not gen._exclusive_blank(["code", "coach"])  # shared prefix, unrelated words
    assert not gen._exclusive_blank(["the"])  # a blank needs a choice


async def test_generator_rejects_a_card_with_an_undecidable_blank(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "text": "The developer ___ fixes the ___ bug in production.",
                "blanks": [
                    {"options": ["often", "always"], "answer": "often"},
                    {"options": ["scary large", "large scary"], "answer": "scary large"},
                ],
            }
        ),
    )
    assert await gen._gen_multiple_blanks("word order", level="B1") is None


async def test_generator_accepts_grammatically_exclusive_blanks(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "text": "She ___ the report ___ Monday morning.",
                "blanks": [
                    {"options": ["send", "sent"], "answer": "sent"},
                    {"options": ["in", "on"], "answer": "on"},
                ],
            }
        ),
    )
    out = await gen._gen_multiple_blanks("prepositions", level="B1")
    assert out is not None
    assert tokens.unseal(out["token"])["answers"] == ["sent", "on"]
