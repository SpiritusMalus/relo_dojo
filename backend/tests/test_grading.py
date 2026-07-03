"""Deterministic interactive grading (app.services.grammar.grade) — the LLM-free /check path."""

from app.services import grammar


def test_multiple_choice_exact_match_case_insensitive():
    sealed = {"t": "multiple-choice", "answer": "an"}
    assert grammar.grade(sealed, "an")["correct"] is True
    assert grammar.grade(sealed, " AN ")["correct"] is True  # normalized
    assert grammar.grade(sealed, "a")["correct"] is False


def test_sanitize_mistakes_caps_count_and_length_and_strips_whitespace():
    raw = [f"item {i}" for i in range(10)]
    out = grammar._sanitize_mistakes(raw)
    assert len(out) == grammar.MAX_MISTAKE_HINTS  # capped
    # collapses newlines/extra spaces and truncates long entries
    cleaned = grammar._sanitize_mistakes(["  she\n\n  is   ___  engineer  ", "x" * 500])
    assert cleaned[0] == "she is ___ engineer"
    assert len(cleaned[1]) <= grammar._MISTAKE_MAX_LEN
    assert grammar._sanitize_mistakes(None) == []
    assert grammar._sanitize_mistakes(["", "   "]) == []


def test_mistakes_clause_is_empty_without_items_and_present_with():
    assert grammar._mistakes_clause(None) == ""
    assert grammar._mistakes_clause([]) == ""
    clause = grammar._mistakes_clause(["She is ___ engineer."])
    assert "WRONG" in clause and "NEW" in clause  # instructs a fresh item on the same point
    assert "She is ___ engineer." in clause


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


def test_transform_the_sentence_grades_like_build():
    # Same deterministic word-position path as build-the-sentence (sealed target sentence).
    sealed = {"t": "transform-the-sentence", "sentence": "She did not call me"}
    assert grammar.grade(sealed, "She did not call me")["correct"] is True
    assert grammar.grade(sealed, " she DID not call me ")["correct"] is True  # normalized
    wrong = grammar.grade(sealed, "She did call not me")
    assert wrong["correct"] is False
    assert 0 < wrong["score"] < 1  # leading words in position → partial credit


def test_match_pairs_all_or_nothing_with_partial_score():
    # Legacy tokens (pre opaque-ids): right ids equal their left's id.
    sealed = {"t": "match-pairs", "ids": [0, 1, 2]}
    correct = grammar.grade(sealed, {"0": 0, "1": 1, "2": 2})
    assert correct["correct"] is True
    half = grammar.grade(sealed, {"0": 0, "1": 2, "2": 1})
    assert half["correct"] is False
    assert half["detail"] == "1/3"
    assert half["per_item"] == [True, False, False]


def test_match_pairs_sealed_map_grades_by_mapping_not_id():
    # Current tokens: right ids are shuffled positions; the truth lives in the sealed map.
    sealed = {
        "t": "match-pairs",
        "map": {"0": 2, "1": 0, "2": 1},
        "rights": {"0": "starts", "1": "shows", "2": "will"},
    }
    correct = grammar.grade(sealed, {"0": 2, "1": 0, "2": 1})
    assert correct["correct"] is True
    one_wrong = grammar.grade(sealed, {"0": 2, "1": 1, "2": 0})
    assert one_wrong["correct"] is False
    assert one_wrong["detail"] == "1/3"
    assert one_wrong["per_item"] == [True, False, False]


def test_match_pairs_identical_text_tiles_are_interchangeable():
    # Two tiles both reading "will" (prod screenshot 2026-07-03): the learner can't tell them
    # apart, so crossing them must still count as correct.
    sealed = {
        "t": "match-pairs",
        "map": {"0": 0, "1": 1, "2": 2, "3": 3},
        "rights": {"0": "shows", "1": "starts", "2": "will", "3": "will"},
    }
    crossed = grammar.grade(sealed, {"0": 0, "1": 1, "2": 3, "3": 2})  # the two "will"s swapped
    assert crossed["correct"] is True
    assert crossed["per_item"] == [True, True, True, True]
    # ...but a genuinely different text still fails.
    wrong = grammar.grade(sealed, {"0": 0, "1": 2, "2": 3, "3": 1})
    assert wrong["correct"] is False
    assert wrong["per_item"] == [True, False, True, False]


def test_unknown_kind_is_safe():
    assert grammar.grade({"t": "forged"}, "whatever")["correct"] is False
