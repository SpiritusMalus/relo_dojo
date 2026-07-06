"""Listening comprehension (аудирование) — the wave-2 audio-first types.

listen-and-answer: spoken passage (client-side TTS reads `speak`) + one content question, graded
deterministically like a multiple-choice pick. listen-and-retell: spoken passage the learner
retells in writing, LLM-graded on content coverage via /check-retell with the passage sealed in
the token. Both are REQUEST-ONLY (weight 0): an old client can't render the audio card, so the
server must never pick them from the weighted defaults.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.main import check_retell as check_retell_endpoint
from app.services import _grammar_generators as gen
from app.services import grammar, tokens


def _fake_json(payload):
    """Return an async stand-in for llm.generate_json that yields a fixed structured payload."""

    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        return payload

    return _fake


PASSAGE = "Anna painted the front door green last weekend. Her neighbour thought it was red."


# --- listen-and-answer: generation -------------------------------------------


async def test_listen_answer_payload_and_token(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "passage": PASSAGE,
                "question": "What color did Anna paint the door?",
                "options": ["Green", "Red", "Blue"],
                "answer": "Green",
            }
        ),
    )
    out = await gen._gen_listen_answer("prepositions", level="B1")
    assert out is not None
    assert out["type"] == "listen-and-answer"
    # The passage rides ONLY in `speak` (spoken, never shown) — the visible text is the question.
    assert out["speak"] == PASSAGE
    assert out["text"] == "What color did Anna paint the door?"
    assert "Green" in out["options"]
    sealed = tokens.unseal(out["token"])
    assert sealed["t"] == "listen-and-answer"
    assert sealed["answer"] == "Green"
    assert sealed["topic"] == "prepositions"
    assert sealed["text"] == PASSAGE  # the miss-log drill hint is the passage itself


async def test_listen_answer_appends_missing_answer(monkeypatch):
    monkeypatch.setattr(
        gen,
        "generate_json",
        _fake_json(
            {
                "passage": PASSAGE,
                "question": "What color was the door?",
                "options": ["Red", "Blue"],
                "answer": "Green",  # model forgot to include it — generator adds it
            }
        ),
    )
    out = await gen._gen_listen_answer("articles", level="A2")
    assert out is not None
    assert "Green" in out["options"]


@pytest.mark.parametrize(
    "bad",
    [
        {"passage": "Too short.", "question": "Q?", "options": ["a", "b"], "answer": "a"},
        {"passage": PASSAGE, "question": "", "options": ["a", "b"], "answer": "a"},
        {"passage": PASSAGE, "question": "Fill ___ in?", "options": ["a", "b"], "answer": "a"},
        {"passage": PASSAGE, "question": "Q?", "options": ["a"], "answer": ""},
        {"passage": "word " * 200, "question": "Q?", "options": ["a", "b"], "answer": "a"},
    ],
)
async def test_listen_answer_rejects_unusable(monkeypatch, bad):
    monkeypatch.setattr(gen, "generate_json", _fake_json(bad))
    assert await gen._gen_listen_answer("prepositions", level="B1") is None


# --- listen-and-retell: generation --------------------------------------------


async def test_listen_retell_payload_and_token(monkeypatch):
    monkeypatch.setattr(gen, "generate_json", _fake_json({"passage": PASSAGE}))
    out = await gen._gen_listen_retell("verb sequence (tense agreement)", level="B2")
    assert out is not None
    assert out["type"] == "listen-and-retell"
    assert out["speak"] == PASSAGE
    assert out["text"] == ""  # the client shows its own localized retell instruction
    sealed = tokens.unseal(out["token"])
    assert sealed["t"] == "listen-and-retell"
    assert sealed["passage"] == PASSAGE
    assert sealed["topic"] == "verb sequence (tense agreement)"


# --- request-only routing ------------------------------------------------------


async def test_listening_is_request_only(monkeypatch):
    # Explicitly requested → the listening generator runs.
    called = {}

    async def _spy(topic, level=None, context=None, mistakes=None, lang=None, retry_note=""):
        called["hit"] = True
        return {"type": "listen-and-answer", "topic": topic, "text": "Q?", "speak": PASSAGE, "options": ["a"], "token": None}

    monkeypatch.setitem(gen._GENERATORS, "listen-and-answer", _spy)
    out = await gen.generate_exercise(topic="prepositions", ex_type="listen-and-answer", level="B1")
    assert called.get("hit") and out["type"] == "listen-and-answer"
    # ...but the weighted defaults can never pick it: weight 0 in EXERCISE_TYPES.
    weights = dict(gen.EXERCISE_TYPES)
    assert weights["listen-and-answer"] == 0
    assert weights["listen-and-retell"] == 0
    assert "listen-and-answer" not in gen._ENABLED_TYPES
    assert gen._REQUESTABLE_TYPES == {"listen-and-answer", "listen-and-retell"}


# --- deterministic grading -----------------------------------------------------


def test_listen_answer_grades_like_multiple_choice():
    sealed = {"t": "listen-and-answer", "answer": "Green", "topic": "articles", "text": PASSAGE}
    assert grammar.grade(sealed, "green")["correct"] is True  # case-folded
    wrong = grammar.grade(sealed, "Red")
    assert wrong["correct"] is False
    assert wrong["correct_answer"] == "Green"


# --- /check-retell endpoint ----------------------------------------------------


class _UntouchableDb:
    """No DB access expected on these paths; explode if something tries."""

    def __getattr__(self, name):  # noqa: ANN001
        raise AssertionError(f"unexpected db access: {name}")


async def test_check_retell_grades_and_pins_passage(monkeypatch):
    from app import main as app_main

    token = tokens.seal({"t": "listen-and-retell", "passage": PASSAGE, "topic": "articles"})

    async def _fake_check_retell(passage, retelling, lang=None, tone=None, weak_spots=None):
        assert passage == PASSAGE  # graded against exactly what was sealed
        return {"correct": True, "correct_answer": passage, "explanation": "ok", "tip": ""}

    monkeypatch.setattr(app_main.grammar, "check_retell", _fake_check_retell)
    payload = SimpleNamespace(token=token, retell="anna painted the door green", lang="ru")
    out = await check_retell_endpoint(payload, user=None, db=_UntouchableDb())
    assert out.correct is True
    assert out.correct_answer == PASSAGE  # the reveal IS the passage


async def test_check_retell_logs_miss_on_wrong(monkeypatch):
    from app import main as app_main

    token = tokens.seal({"t": "listen-and-retell", "passage": PASSAGE, "topic": "articles"})

    async def _fake_check_retell(passage, retelling, lang=None, tone=None, weak_spots=None):
        return {"correct": False, "correct_answer": passage, "explanation": "missed it", "tip": "listen twice"}

    recorded = {}

    async def _fake_record_miss(db, user, topic, text):
        recorded["topic"], recorded["text"] = topic, text

    monkeypatch.setattr(app_main.grammar, "check_retell", _fake_check_retell)
    monkeypatch.setattr(app_main.miss_log, "record_miss", _fake_record_miss)
    payload = SimpleNamespace(token=token, retell="there was a cat", lang=None)
    out = await check_retell_endpoint(payload, user=None, db=SimpleNamespace())
    assert out.correct is False
    assert recorded == {"topic": "articles", "text": PASSAGE}


async def test_check_retell_rejects_foreign_tokens():
    # A multiple-choice token must not open the LLM retell path (not a free-form proxy).
    token = tokens.seal({"t": "multiple-choice", "answer": "at", "topic": "prepositions"})
    payload = SimpleNamespace(token=token, retell="whatever", lang=None)
    with pytest.raises(HTTPException) as exc:
        await check_retell_endpoint(payload, user=None, db=_UntouchableDb())
    assert exc.value.status_code == 400
