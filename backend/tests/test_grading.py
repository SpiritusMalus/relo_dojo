"""Deterministic interactive grading (app.services.grammar.grade) — the LLM-free /check path."""

from app.services import grammar


def test_multiple_choice_exact_match_case_insensitive():
    sealed = {"t": "multiple-choice", "answer": "an"}
    assert grammar.grade(sealed, "an")["correct"] is True
    assert grammar.grade(sealed, " AN ")["correct"] is True  # normalized
    assert grammar.grade(sealed, "a")["correct"] is False


def test_odd_one_out_uses_same_path():
    sealed = {"t": "odd-one-out", "answer": "banana"}
    assert grammar.grade(sealed, "banana")["correct"] is True
    assert grammar.grade(sealed, "apple")["correct"] is False


def test_tap_the_error_index_match():
    sealed = {"t": "tap-the-error", "index": 3, "answer": "goes"}
    assert grammar.grade(sealed, 3)["correct"] is True
    assert grammar.grade(sealed, 1)["correct"] is False
    assert grammar.grade(sealed, "nope")["correct"] is False  # non-int -> wrong, no crash


def test_multiple_blanks_partial_credit():
    sealed = {"t": "multiple-blanks", "answers": ["in", "on", "at"]}
    full = grammar.grade(sealed, ["in", "on", "at"])
    assert full["correct"] is True
    assert full["score"] == 1.0
    partial = grammar.grade(sealed, ["in", "on", "xx"])
    assert partial["correct"] is False
    assert partial["detail"] == "2/3"
    assert 0 < partial["score"] < 1


def test_build_the_sentence_partial_credit():
    sealed = {"t": "build-the-sentence", "sentence": "I fixed the bug"}
    assert grammar.grade(sealed, "I fixed the bug")["correct"] is True
    wrong = grammar.grade(sealed, "I fixed bug the")
    assert wrong["correct"] is False
    assert 0 < wrong["score"] < 1  # first two words in position


def test_match_pairs_all_or_nothing_with_partial_score():
    sealed = {"t": "match-pairs", "ids": [0, 1, 2]}
    correct = grammar.grade(sealed, {"0": 0, "1": 1, "2": 2})
    assert correct["correct"] is True
    half = grammar.grade(sealed, {"0": 0, "1": 2, "2": 1})
    assert half["correct"] is False
    assert half["detail"] == "1/3"


def test_unknown_kind_is_safe():
    assert grammar.grade({"t": "forged"}, "whatever")["correct"] is False
