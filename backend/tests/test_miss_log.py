"""Server-side miss log: hint merging (pure), the /check capture and /exercise retrieval wiring,
and the token plumbing that carries topic/text into grading. No HTTP/DB — endpoint functions are
driven directly with monkeypatched services, like test_exercise_profile_context."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.main import check, exercise
from app.schemas import CheckIn, ExerciseIn
from app.services import _grammar_generators as gen
from app.services import gating, grammar, miss_log, tokens
from app.services import wallet as wallet_service


# --- merge_hints (pure) --------------------------------------------------------
def test_merge_hints_client_leads_server_fills_deduped():
    merged = miss_log.merge_hints(["I go ___ work."], ["She said me hi.", "i go ___  work.", "He rise the price."], cap=3)
    assert merged == ["I go ___ work.", "She said me hi.", "He rise the price."]


def test_merge_hints_caps_and_skips_blanks():
    merged = miss_log.merge_hints(["a", "", "  "], ["b", "c", "d"], cap=3)
    assert merged == ["a", "b", "c"]


# --- record_miss guards (no DB touched on the no-op paths) ----------------------
class _UntouchableDb:
    def __getattr__(self, name):  # any session use is a test failure
        raise AssertionError(f"db must not be touched, got .{name}")


async def test_record_miss_noops_without_user_topic_or_text():
    db = _UntouchableDb()
    user = SimpleNamespace(id="u1")
    await miss_log.record_miss(db, None, "prepositions", "I go ___ work.")
    await miss_log.record_miss(db, user, None, "I go ___ work.")
    await miss_log.record_miss(db, user, "  ", "I go ___ work.")
    await miss_log.record_miss(db, user, "prepositions", "   ")


# --- /check capture wiring -------------------------------------------------------
def _mc_token(**extra) -> str:
    return tokens.seal({"t": "multiple-choice", "answer": "at", **extra})


@pytest.fixture()
def _quiet_wallet(monkeypatch):
    async def _no_reset(user, db):
        return None

    async def _no_award(user, db, jti=None):
        return 0, None, 0, 0

    monkeypatch.setattr(wallet_service, "reset_correct_run", _no_reset)
    monkeypatch.setattr(wallet_service, "award_correct_check", _no_award)


async def test_wrong_check_records_the_sealed_topic_and_text(monkeypatch, _quiet_wallet):
    recorded = []

    async def _capture(db, user, topic, text):
        recorded.append((topic, text))

    monkeypatch.setattr(miss_log, "record_miss", _capture)
    token = _mc_token(topic="prepositions", text="I arrive ___ 6 pm.")
    out = await check(CheckIn(token=token, response="on"), user=SimpleNamespace(id="u1"), db=object())
    assert out.correct is False
    assert recorded == [("prepositions", "I arrive ___ 6 pm.")]


async def test_wrong_check_falls_back_to_the_sealed_sentence(monkeypatch, _quiet_wallet):
    # build/transform tokens carry the target under "sentence", not "text".
    recorded = []

    async def _capture(db, user, topic, text):
        recorded.append((topic, text))

    monkeypatch.setattr(miss_log, "record_miss", _capture)
    token = tokens.seal({"t": "build-the-sentence", "sentence": "She told me the truth.", "topic": "vocabulary"})
    await check(CheckIn(token=token, response="She said me the truth."), user=SimpleNamespace(id="u1"), db=object())
    assert recorded == [("vocabulary", "She told me the truth.")]


async def test_correct_check_records_nothing(monkeypatch, _quiet_wallet):
    async def _boom(db, user, topic, text):
        raise AssertionError("a correct answer must not be logged as a miss")

    monkeypatch.setattr(miss_log, "record_miss", _boom)
    token = _mc_token(topic="prepositions", text="I arrive ___ 6 pm.")
    out = await check(CheckIn(token=token, response="at"), user=SimpleNamespace(id="u1"), db=object())
    assert out.correct is True


async def test_legacy_token_without_extras_still_grades(monkeypatch, _quiet_wallet):
    recorded = []

    async def _capture(db, user, topic, text):
        recorded.append((topic, text))

    monkeypatch.setattr(miss_log, "record_miss", _capture)
    out = await check(CheckIn(token=_mc_token(), response="on"), user=SimpleNamespace(id="u1"), db=object())
    assert out.correct is False
    assert recorded == [(None, None)]  # forwarded as-is; record_miss itself no-ops on those


# --- /exercise retrieval wiring ---------------------------------------------------
class _Captured(Exception):
    def __init__(self, mistakes):
        self.mistakes = mistakes


@pytest.fixture(autouse=True)
def _no_quota(monkeypatch):
    monkeypatch.setattr(gating, "ensure_daily_quota", lambda user: None)


def _authed(consented: bool = True) -> SimpleNamespace:
    return SimpleNamespace(id="u1", pd_consent_at=datetime.now(timezone.utc) if consented else None)


async def _run_exercise(payload, user, monkeypatch, server_hints):
    async def _fake_generate(**kwargs):
        raise _Captured(kwargs.get("mistakes"))

    async def _fake_recent(db, u, topic, limit):
        if server_hints is None:
            raise AssertionError("server miss log must not be consulted")
        return server_hints

    async def _no_profile(u, db):
        return None

    monkeypatch.setattr(grammar, "generate_exercise", _fake_generate)
    monkeypatch.setattr(miss_log, "recent_misses", _fake_recent)
    monkeypatch.setattr("app.main.learner_profile.get_data", _no_profile)
    with pytest.raises(_Captured) as exc:
        await exercise(payload=payload, user=user, db=object())
    return exc.value.mistakes


async def test_server_hints_top_up_client_hints(monkeypatch):
    payload = ExerciseIn(topic="prepositions", mistakes=["I go ___ work."])
    got = await _run_exercise(payload, _authed(), monkeypatch, ["We meet ___ Monday.", "I go ___ work."])
    assert got == ["I go ___ work.", "We meet ___ Monday."]  # client first, server deduped in


async def test_full_client_hints_skip_the_server(monkeypatch):
    payload = ExerciseIn(topic="prepositions", mistakes=["a", "b", "c"])
    got = await _run_exercise(payload, _authed(), monkeypatch, None)
    assert got == ["a", "b", "c"]


async def test_unconsented_or_anonymous_skip_the_server(monkeypatch):
    payload = ExerciseIn(topic="prepositions")
    assert await _run_exercise(payload, _authed(consented=False), monkeypatch, None) == []
    assert await _run_exercise(payload, None, monkeypatch, None) == []


async def test_off_canon_or_missing_topic_skips_the_server(monkeypatch):
    # Without a canonical client-chosen topic, generation picks its own — server hints would
    # target the wrong topic, so the log must not be consulted.
    assert await _run_exercise(ExerciseIn(), _authed(), monkeypatch, None) == []
    assert await _run_exercise(ExerciseIn(topic="astrophysics"), _authed(), monkeypatch, None) == []


# --- generator → token plumbing -----------------------------------------------------
async def test_mc_token_carries_topic_and_text(monkeypatch):
    async def _fake(prompt, schema, temperature=0.0):
        return {"text": "I arrive ___ 6 pm.", "options": ["at", "on", "in"], "answer": "at"}

    monkeypatch.setattr(gen, "generate_json", _fake)
    out = await gen._gen_multiple_choice("prepositions", level="A2")
    sealed = tokens.unseal(out["token"])
    assert sealed["topic"] == "prepositions"
    assert sealed["text"] == "I arrive ___ 6 pm."
    # Grading is untouched by the extras.
    assert grammar.grade(sealed, "at")["correct"] is True
