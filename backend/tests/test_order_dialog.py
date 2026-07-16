"""order-the-dialog now spans 4-8 lines (was 3-5). The renderer and the position grader already
handle any N, so this pins the generator's accept/reject window and the grade at length 8."""

from app.services import _grammar_generators as gen
from app.services import grammar, tokens


def _fake_json(payload):
    """Return an async stand-in for llm.generate_json that yields a fixed structured payload."""

    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


async def test_accepts_eight_lines(monkeypatch):
    lines = [f"Line number {i}." for i in range(8)]
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": lines}))
    out = await gen._gen_order_the_dialog("word order", level="C1")
    assert out is not None
    assert out["type"] == "order-the-dialog"
    # The opening line is given; the learner orders the remaining 7 tiles.
    assert out["anchor"] == lines[0]
    assert len(out["tiles"]) == 7
    assert sorted(out["tiles"]) == sorted(lines[1:])
    # Tiles are shuffled away from the solution; the sealed order keeps the FULL correct sequence.
    assert out["tiles"] != lines[1:]
    assert tokens.unseal(out["token"])["order"] == lines


async def test_accepts_four_lines(monkeypatch):
    lines = ["Hi there.", "How are you?", "I'm good, thanks.", "Glad to hear it."]
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": lines}))
    out = await gen._gen_order_the_dialog("word order", level="A2")
    assert out is not None
    assert out["anchor"] == "Hi there."
    assert len(out["tiles"]) == 3


async def test_anchored_order_grades_full_sequence(monkeypatch):
    # The client submits [anchor, ...its picks]; grading compares that against the sealed full order.
    lines = ["Hi there.", "How are you?", "I'm good, thanks.", "Glad to hear it."]
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": lines}))
    out = await gen._gen_order_the_dialog("word order", level="A2")
    sealed = tokens.unseal(out["token"])
    submitted = [out["anchor"], *out["tiles"]]  # learner leaves the shuffled tiles as-is
    graded = grammar.grade(sealed, submitted)
    # anchor is correct at position 0, so at least one line always lands right.
    assert graded["per_item"][0] is True
    # A fully correct submission (anchor + tiles already in order) scores 1.0.
    perfect = grammar.grade(sealed, lines)
    assert perfect["correct"] is True and perfect["score"] == 1.0


async def test_rejects_three_lines(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": ["a", "b", "c"]}))
    # Three is now under the floor → generator rejects (caller falls back to another type).
    assert await gen._gen_order_the_dialog("word order", level="B1") is None


async def test_rejects_nine_lines(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": [f"l{i}" for i in range(9)]}))
    assert await gen._gen_order_the_dialog("word order", level="C1") is None


async def test_rejects_duplicate_lines(monkeypatch):
    # Distinctness is required for an unambiguous ordering — duplicates (after normalization) reject.
    monkeypatch.setattr(gen, "generate_json", _fake_json({"lines": ["Let's go.", "Sure.", "  SURE. ", "Okay then."]}))
    assert await gen._gen_order_the_dialog("word order", level="B1") is None


def test_grade_position_partial_credit_at_length_eight():
    order = [f"Line {i}" for i in range(8)]
    sealed = {"t": "order-the-dialog", "order": order}
    full = grammar.grade(sealed, order)
    assert full["correct"] is True
    assert full["score"] == 1.0
    # Swap the last two → 6 of 8 in position, not correct, partial score.
    near = order[:6] + [order[7], order[6]]
    miss = grammar.grade(sealed, near)
    assert miss["correct"] is False
    assert miss["detail"] == "6/8"
    assert 0 < miss["score"] < 1
