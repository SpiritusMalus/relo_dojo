"""Learner profile (Stage 1) — pure-layer tests: schema validation, goal history, feedback clause."""

from app.schemas import LearnerProfileData, TONES
from app.services.grammar import (
    FEEDBACK_STYLE,
    TONE_LINES,
    _check_prompt,
    _feedback_clause,
    _history_clause,
)
from app.services.learner_profile import (
    MAX_GOAL_HISTORY,
    _CONTEXT_MAX_LEN,
    apply_goal,
    context_for,
)


# --- schema -------------------------------------------------------------------
def test_tone_defaults_to_balanced():
    assert LearnerProfileData().tone == "balanced"
    assert LearnerProfileData(tone="nonsense").tone == "balanced"
    for t in TONES:
        assert LearnerProfileData(tone=t).tone == t


def test_profile_roundtrip():
    data = LearnerProfileData(goal="write to my boss", sphere="Law", tone="strict")
    again = LearnerProfileData(**data.model_dump())
    assert again == data


# --- goal history -------------------------------------------------------------
def test_apply_goal_sets_current_and_appends_history():
    data = LearnerProfileData()
    apply_goal(data, "interviews scare me", ["conditionals"], today="2026-06-11")
    apply_goal(data, "emails to clients", ["prepositions"], today="2026-06-12")
    assert data.goal == "emails to clients"
    assert data.goalTopics == ["prepositions"]
    assert [g.text for g in data.goalHistory] == ["interviews scare me", "emails to clients"]
    assert data.goalHistory[0].date == "2026-06-11"


def test_goal_history_is_bounded():
    data = LearnerProfileData()
    for i in range(MAX_GOAL_HISTORY + 5):
        apply_goal(data, f"goal {i}", [], today="2026-06-11")
    assert len(data.goalHistory) == MAX_GOAL_HISTORY
    assert data.goalHistory[-1].text == f"goal {MAX_GOAL_HISTORY + 4}"


# --- feedback prompt ----------------------------------------------------------
def test_feedback_clause_tone_selection_and_fallback():
    assert TONE_LINES["soft"] in _feedback_clause("soft")
    assert TONE_LINES["strict"] in _feedback_clause("strict")
    # unknown / missing tone falls back to balanced
    assert TONE_LINES["balanced"] in _feedback_clause(None)
    assert TONE_LINES["balanced"] in _feedback_clause("weird")
    # rephrase-not-"wrong" style is always present
    assert FEEDBACK_STYLE in _feedback_clause("soft")


def test_history_clause_sanitized_and_optional():
    assert _history_clause(None) == ""
    assert _history_clause("   ") == ""
    clause = _history_clause("struggles  with\nconditionals " + "x" * 500)
    assert "struggles with conditionals" in clause
    assert len(clause) < 600  # capped


def test_check_prompt_threads_tone_and_history():
    p = _check_prompt("Fill: I go ___ work", "in", lang="ru", tone="soft", weak_spots="prepositions in/at")
    assert TONE_LINES["soft"] in p
    assert "prepositions in/at" in p
    assert "Russian" in p


def test_check_prompt_carries_grading_anchors():
    # The anchors fight the grader's one-sided failure mode (correct answers marked wrong) —
    # they must ride in every check prompt, with one worked example per verdict.
    from app.services._grammar_feedback import GRADING_ANCHORS

    p = _check_prompt("Fill: I go ___ work", "to")
    assert GRADING_ANCHORS in p
    assert "correct=true" in p and "correct=false" in p


# --- context_for: profile → generation context line ---------------------------
def test_context_for_none_and_empty_profile_is_blank():
    assert context_for(None) == ""
    assert context_for(LearnerProfileData()) == ""


def test_context_for_composes_goal_field_interests_weak_spots():
    data = LearnerProfileData(
        goal="pass a relocation interview",
        sphere="Backend engineering",
        interests=["football", "cooking"],
        weakSpots="confuses past simple vs present perfect",
    )
    ctx = context_for(data)
    assert "goal: pass a relocation interview" in ctx
    assert "field: Backend engineering" in ctx
    assert "interests: football, cooking" in ctx
    assert "weak spots to drill: confuses past simple vs present perfect" in ctx


def test_context_for_collapses_whitespace_and_caps_interests():
    data = LearnerProfileData(
        goal="speak\n  to   my team",
        interests=[f"i{i}" for i in range(10)],
    )
    ctx = context_for(data)
    assert "goal: speak to my team" in ctx  # whitespace collapsed
    assert "i0, i1, i2, i3, i4" in ctx  # first 5 only
    assert "i5" not in ctx


def test_context_for_is_length_bounded():
    data = LearnerProfileData(goal="g " * 200, weakSpots="w " * 200)
    assert len(context_for(data)) <= _CONTEXT_MAX_LEN
