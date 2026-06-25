"""/exercise injects the learner's OWN profile as generation context (profile-into-generation).

Server-side wiring: when an authenticated, consented caller omits `context`, the endpoint composes
one from their profile (learner_profile.context_for) and feeds it to generation. Client-supplied
context always wins; anonymous / no-profile / unconsented callers behave exactly as before.

We drive the endpoint function directly (no HTTP/DB), capturing the context that reaches
generate_exercise via a sentinel exception so we never need to satisfy the full ExerciseOut shape.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.main import exercise
from app.schemas import ExerciseIn, LearnerProfileData
from app.services import gating, grammar, learner_profile


class _Captured(Exception):
    """Carries the context arg that reached generate_exercise, short-circuiting the endpoint."""

    def __init__(self, context):
        self.context = context


@pytest.fixture(autouse=True)
def _no_quota(monkeypatch):
    monkeypatch.setattr(gating, "ensure_daily_quota", lambda user: None)


def _capture_context(monkeypatch):
    async def _fake_generate(**kwargs):
        raise _Captured(kwargs.get("context"))

    monkeypatch.setattr(grammar, "generate_exercise", _fake_generate)


def _authed(consented: bool) -> SimpleNamespace:
    return SimpleNamespace(
        id="u1",
        pd_consent_at=datetime.now(timezone.utc) if consented else None,
    )


async def _run(payload, user, monkeypatch, profile):
    _capture_context(monkeypatch)

    async def _fake_get_data(u, db):
        return profile

    monkeypatch.setattr(learner_profile, "get_data", _fake_get_data)
    with pytest.raises(_Captured) as exc:
        await exercise(payload=payload, user=user, db=object())
    return exc.value.context


async def test_authed_consented_with_profile_injects_composed_context(monkeypatch):
    prof = LearnerProfileData(goal="ace a relocation interview", sphere="Backend")
    ctx = await _run(ExerciseIn(), _authed(consented=True), monkeypatch, prof)
    assert ctx == learner_profile.context_for(prof)
    assert "ace a relocation interview" in ctx


async def test_client_context_always_wins_no_profile_lookup(monkeypatch):
    # If get_data were consulted the test would still pass, but the override must take precedence.
    prof = LearnerProfileData(goal="should be ignored")
    ctx = await _run(ExerciseIn(context="hospital night shift"), _authed(True), monkeypatch, prof)
    assert ctx == "hospital night shift"


async def test_anonymous_caller_unchanged(monkeypatch):
    ctx = await _run(ExerciseIn(), None, monkeypatch, None)
    assert ctx is None  # byte-for-byte today's behavior (payload.context default)


async def test_authed_without_profile_injects_empty_string(monkeypatch):
    ctx = await _run(ExerciseIn(), _authed(True), monkeypatch, None)
    assert ctx == ""  # context_for(None) → "", no fabrication


async def test_unconsented_authed_user_gets_no_profile_context(monkeypatch):
    prof = LearnerProfileData(goal="do not egress without consent")
    ctx = await _run(ExerciseIn(), _authed(consented=False), monkeypatch, prof)
    assert ctx is None  # consent gate keeps profile text from reaching the LLM
