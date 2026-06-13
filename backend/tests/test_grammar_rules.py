"""Grammar-rules RAG: the reference clause + its injection into the tutor prompt (pure, no LLM)."""

from __future__ import annotations

from app.services._grammar_prompts import TOPICS, _tutor_intro
from app.services._grammar_rules import GRAMMAR_RULES, rules_clause


def test_every_canonical_topic_has_a_rule():
    # Keys must stay in sync with the weighted topic mix, or generation silently loses the anchor.
    assert {t for t, _ in TOPICS} == set(GRAMMAR_RULES)


def test_rules_clause_for_known_topic_quotes_the_rule():
    clause = rules_clause("conditionals")
    assert "Authoritative rule for conditionals" in clause
    assert GRAMMAR_RULES["conditionals"] in clause
    assert clause.endswith("\n")


def test_rules_clause_blank_for_unknown_or_empty_topic():
    assert rules_clause(None) == ""
    assert rules_clause("") == ""
    assert rules_clause("astrophysics") == ""


def test_tutor_intro_injects_the_rule_when_topic_given():
    with_topic = _tutor_intro("Make an exercise.", level="B1", topic="articles")
    assert GRAMMAR_RULES["articles"] in with_topic
    # No topic → no rule clause (back-compatible with the old call sites).
    assert "Authoritative rule" not in _tutor_intro("Make an exercise.", level="B1")
