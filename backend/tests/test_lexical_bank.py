"""Lexical-bank RAG: curated word units sampled into generation prompts for the two lexical topics
(vocabulary, phrasal verbs) — and ONLY those. Pure, no LLM."""

from __future__ import annotations

import random

from app.services._grammar_prompts import _tutor_intro
from app.services._lexical_bank import (
    LEXICAL_BANKS,
    MAX_LEXICAL_UNITS,
    PHRASAL_BANK,
    VOCAB_BANK,
    lexical_clause,
)


def test_banks_cover_every_band_with_enough_units():
    # Each band must be able to fill a full sample, or the clause silently shrinks.
    for bank in (VOCAB_BANK, PHRASAL_BANK):
        assert set(bank) == {"A", "B", "C"}
        for units in bank.values():
            assert len(units) >= MAX_LEXICAL_UNITS
            assert all(u.strip() for u in units)


def test_clause_samples_from_the_right_band():
    rng = random.Random(7)
    clause = lexical_clause("vocabulary", "A1", rng)
    assert "Curated word bank" in clause
    assert clause.endswith("\n")
    # Every sampled unit comes from the A band verbatim (numbered so the model can pick ONE).
    assert sum(u in clause for u in VOCAB_BANK["A"]) == MAX_LEXICAL_UNITS
    assert f"({MAX_LEXICAL_UNITS})" in clause
    assert "exactly ONE of these units" in clause


def test_unknown_band_falls_back_to_b():
    clause = lexical_clause("phrasal verbs", None, random.Random(7))
    assert sum(u in clause for u in PHRASAL_BANK["B"]) == MAX_LEXICAL_UNITS


def test_structural_topics_get_no_bank():
    assert lexical_clause("articles", "B1") == ""
    assert lexical_clause(None, "B1") == ""
    assert lexical_clause("astrophysics", "B1") == ""
    assert set(LEXICAL_BANKS) == {"vocabulary", "phrasal verbs"}


def test_tutor_intro_injects_the_bank_only_for_lexical_topics():
    assert "Curated word bank" in _tutor_intro("Make an exercise.", level="B1", topic="vocabulary")
    assert "Curated word bank" not in _tutor_intro("Make an exercise.", level="B1", topic="articles")
    # Feedback prompts call _tutor_intro() without a topic — the bank must never leak into them.
    assert "Curated word bank" not in _tutor_intro()
