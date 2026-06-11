"""Stage 2 agents — offline tests: digests, prompts, weight sanitization, profile application."""

from app.schemas import LearnerProfileData, SessionAnswer, TopicStatsIn
from app.services import agents
from app.services.agents import (
    WEIGHT_MAX,
    WEIGHT_MIN,
    plan_prompt,
    progress_prompt,
    run_planner,
    run_progress_agent,
    sanitize_weights,
    session_digest,
    stats_digest,
)


def _answers():
    return [
        SessionAnswer(topic="articles", correct=True, level="B1"),
        SessionAnswer(topic="articles", correct=False, level="B1"),
        SessionAnswer(topic="prepositions", correct=True, level="A2"),
    ]


def test_session_digest_aggregates():
    assert session_digest(_answers()) == "articles: 1/2; prepositions: 1/1"


def test_progress_prompt_includes_memory_goal_and_lang():
    prof = LearnerProfileData(goal="emails to my boss", weakSpots="mixes in/at")
    p = progress_prompt(prof, _answers(), "ru")
    assert "emails to my boss" in p and "mixes in/at" in p
    assert "articles: 1/2" in p and "Russian" in p


def test_stats_digest_skips_untouched_topics():
    stats = {"articles": TopicStatsIn(attempts=4, correct=3, skill=2.5)}
    d = stats_digest(stats)
    assert d == "articles: 3/4, level 2.5/5"
    assert stats_digest({}) == "no practice data yet"


def test_sanitize_weights_clamps_and_drops_junk():
    out = sanitize_weights({"articles": 9, "prepositions": 0.1, "vocabulary": "high", "fake": 1.5})
    assert out["articles"] == WEIGHT_MAX
    assert out["prepositions"] == WEIGHT_MIN
    assert "vocabulary" not in out and "fake" not in out
    assert sanitize_weights("garbage") == {}


async def test_run_progress_agent_applies_sanitized_delta(monkeypatch):
    async def fake(prompt, schema, *, temperature=None):
        return {"weak_spots": "  still mixes  in/at ", "wins": " Nailed articles today! "}

    monkeypatch.setattr(agents, "generate_json", fake)
    prof = await run_progress_agent(LearnerProfileData(weakSpots="old"), _answers(), "en")
    assert prof.weakSpots == "still mixes in/at"
    assert prof.wins == "Nailed articles today!"


async def test_run_progress_agent_keeps_memory_on_empty_output(monkeypatch):
    async def fake(prompt, schema, *, temperature=None):
        return {"weak_spots": "", "wins": ""}

    monkeypatch.setattr(agents, "generate_json", fake)
    prof = await run_progress_agent(LearnerProfileData(weakSpots="old", wins="w"), _answers(), "en")
    assert prof.weakSpots == "old" and prof.wins == "w"


async def test_run_planner_saves_clamped_plan_with_goal_and_date(monkeypatch):
    async def fake(prompt, schema, *, temperature=None):
        return {"topic_weights": {"articles": 3.0, "word order": 1.2}, "note": " Focus week. "}

    monkeypatch.setattr(agents, "generate_json", fake)
    prof = LearnerProfileData(goal="interviews")
    prof = await run_planner(prof, {}, "en", today="2026-06-11")
    assert prof.plan is not None
    assert prof.plan.topicWeights == {"articles": 2.0, "word order": 1.2}
    assert prof.plan.note == "Focus week."
    assert prof.plan.date == "2026-06-11"
    assert prof.plan.goal == "interviews"


def test_plan_prompt_mentions_bounds():
    p = plan_prompt(LearnerProfileData(), {}, None)
    assert str(WEIGHT_MIN) in p and str(WEIGHT_MAX) in p
