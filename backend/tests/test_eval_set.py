"""Offline sanity checks for the eval set (the runner itself needs Ollama; this doesn't)."""

import json
from pathlib import Path

EVAL_FILE = Path(__file__).resolve().parent.parent / "evals" / "eval_set.json"


def _items() -> list[dict]:
    return json.loads(EVAL_FILE.read_text())["items"]


def test_eval_set_is_wellformed():
    items = _items()
    assert len(items) >= 30, "BACKLOG asks for 30-50 hand-vetted items"
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for it in items:
        assert it["text"].strip(), it["id"]
        assert "___" in it["text"], f"{it['id']}: exercise needs a blank"
        assert isinstance(it["expected"], bool), it["id"]
        assert it["note"].strip(), f"{it['id']}: every item must say why the verdict is right"


def test_eval_set_covers_both_verdicts_and_many_topics():
    items = _items()
    verdicts = {i["expected"] for i in items}
    assert verdicts == {True, False}, "need both correct and incorrect learner answers"
    topics = {i["topic"] for i in items}
    assert len(topics) >= 8, f"want broad topic coverage, got {sorted(topics)}"


def test_eval_set_topics_are_canonical():
    from app.services.grammar import TOPICS

    valid = {t for t, _ in TOPICS}
    for it in _items():
        assert it["topic"] in valid, f"{it['id']}: unknown topic {it['topic']!r}"
