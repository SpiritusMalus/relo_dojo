"""Multi-blank generation now spans 2-5 blanks (was 2-3). The client renderer (MultipleBlanks.tsx)
and the Python grader already handle any N, so this pins the generator's accept/reject window."""

from app.services import _grammar_generators as gen
from app.services import tokens


def _fake_json(payload):
    """Return an async stand-in for llm.generate_json that yields a fixed structured payload."""

    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


async def test_accepts_four_blanks(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "text": "We ___ the form ___ Monday and ___ it ___ Tuesday.",
                "blanks": [
                    {"options": ["sent", "send"], "answer": "sent"},
                    {"options": ["on", "in"], "answer": "on"},
                    {"options": ["signed", "sign"], "answer": "signed"},
                    {"options": ["by", "at"], "answer": "by"},
                ],
            }
        ),
    )
    out = await gen._gen_multiple_blanks("prepositions", level="intermediate")
    assert out is not None
    assert out["type"] == "multiple-blanks"
    assert len(out["blankOptions"]) == 4
    # The sealed token carries all four answers (grading zips picks↔answers).
    assert len(tokens.unseal(out["token"])["answers"]) == 4


async def test_rejects_six_blanks(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "text": "a ___ b ___ c ___ d ___ e ___ f ___ g",
                "blanks": [{"options": ["x", "y"], "answer": "x"} for _ in range(6)],
            }
        ),
    )
    # Six is over the ceiling → generator rejects (caller falls back to multiple-choice).
    assert await gen._gen_multiple_blanks("prepositions", level="advanced") is None
