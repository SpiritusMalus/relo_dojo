"""Unit tests for the generation repair helpers (repair-before-reject).

These are pure/deterministic — no LLM — so they pin the salvage behavior that keeps small-model
outputs usable (multiple-choice / odd-one-out / multiple-blanks were failing ~60% of generations).
"""

from app.services.grammar import _normalize_blanks, _resolve_odd


class TestNormalizeBlanks:
    def test_collapses_long_runs_to_three(self):
        assert _normalize_blanks("I arrive ____ Monday.") == "I arrive ___ Monday."
        assert _normalize_blanks("a __ b _____ c") == "a ___ b ___ c"

    def test_leaves_correct_blanks_untouched(self):
        assert _normalize_blanks("a ___ b ___ c") == "a ___ b ___ c"

    def test_makes_blank_count_match(self):
        # Two intended blanks written as '__' and '____' → both become countable '___'.
        text = _normalize_blanks("She ____ here __ 2019.")
        assert text.count("___") == 2

    def test_single_underscore_left_alone(self):
        # A lone '_' is ambiguous (could be code) — not touched.
        assert _normalize_blanks("var_name stays") == "var_name stays"


class TestResolveOdd:
    items = ["run", "walk", "swim", "happiness"]

    def test_verbatim_match(self):
        assert _resolve_odd("happiness", self.items) == "happiness"

    def test_case_and_space_insensitive(self):
        assert _resolve_odd("  Happiness ", self.items) == "happiness"

    def test_unique_substring_match(self):
        # Model paraphrased the odd item — resolves to the unique contained/containing option.
        assert _resolve_odd("to run quickly", ["to run quickly", "walk", "swim"]) == "to run quickly"
        assert _resolve_odd("running away", ["run", "walk", "swim"]) == "run"

    def test_unresolvable_returns_none(self):
        assert _resolve_odd("elephant", self.items) is None

    def test_empty_returns_none(self):
        assert _resolve_odd("", self.items) is None

    def test_ambiguous_substring_returns_none(self):
        # 'walk' is a substring of two options → ambiguous, refuse rather than guess.
        assert _resolve_odd("walk", ["walking", "walkway", "swim"]) is None
