"""Grammar-rules RAG: the reference clause + its injection into the tutor prompt (pure, no LLM)."""

from __future__ import annotations

from app.services._grammar_prompts import TOPICS, _tutor_intro
from app.services._grammar_rules import GRAMMAR_RULES, GRAMMAR_RULES_BY_BAND, _band, rules_clause


def test_every_canonical_topic_has_a_rule():
    # Keys must stay in sync with the weighted topic mix, or generation silently loses the anchor.
    assert {t for t, _ in TOPICS} == set(GRAMMAR_RULES)


def test_band_refinements_reference_canonical_topics_and_bands():
    # A typo'd topic or band here would silently never fire — pin both dimensions.
    for topic, band in GRAMMAR_RULES_BY_BAND:
        assert topic in GRAMMAR_RULES
        assert band in {"A", "B", "C"}


def test_rules_clause_for_known_topic_quotes_the_rule():
    clause = rules_clause("conditionals")
    assert "Authoritative rule for conditionals" in clause
    assert GRAMMAR_RULES["conditionals"] in clause
    assert clause.endswith("\n")


def test_rules_clause_picks_the_band_refinement():
    # A-band learners get zero/first only — no third-conditional noise at A1.
    a_clause = rules_clause("conditionals", "A1")
    assert GRAMMAR_RULES_BY_BAND[("conditionals", "A")] in a_clause
    assert "past perfect" not in a_clause
    # C-band gets mixed conditionals + inversion.
    c_clause = rules_clause("conditionals", "C1")
    assert GRAMMAR_RULES_BY_BAND[("conditionals", "C")] in c_clause
    assert "Had I known" in c_clause


def test_rules_clause_falls_back_to_the_base_rule():
    # No level / off-scale level / a band without a refinement → the base rule, never "".
    assert GRAMMAR_RULES["conditionals"] in rules_clause("conditionals")
    assert GRAMMAR_RULES["conditionals"] in rules_clause("conditionals", "??")
    assert GRAMMAR_RULES["articles"] in rules_clause("articles", "A1")  # no A-refinement for articles
    assert GRAMMAR_RULES["modal verbs"] in rules_clause("modal verbs", "B1")  # A/C only


def test_band_letter_extraction():
    assert _band("A2") == "A"
    assert _band("b1") == "B"
    assert _band("C1") == "C"
    assert _band(None) == ""
    assert _band("  ") == ""
    assert _band("D7") == ""


def test_rules_clause_blank_for_unknown_or_empty_topic():
    assert rules_clause(None) == ""
    assert rules_clause("") == ""
    assert rules_clause("astrophysics") == ""


def test_tutor_intro_injects_the_rule_when_topic_given():
    with_topic = _tutor_intro("Make an exercise.", level="B1", topic="articles")
    assert GRAMMAR_RULES["articles"] in with_topic
    # No topic → no rule clause (back-compatible with the old call sites).
    assert "Authoritative rule" not in _tutor_intro("Make an exercise.", level="B1")


def test_tutor_intro_injects_the_band_scoped_rule():
    intro = _tutor_intro("Make an exercise.", level="A1", topic="conditionals")
    assert GRAMMAR_RULES_BY_BAND[("conditionals", "A")] in intro
    assert GRAMMAR_RULES["conditionals"] not in intro
