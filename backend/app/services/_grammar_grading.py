"""Deterministic grading of interactive answers (the LLM-free /check path) — instant and reliable.
The correct answer is unsealed from the token (tokens.py) and compared in Python; the LLM never
gates correctness. Split out of the former grammar.py."""

from __future__ import annotations

from typing import Any

from ._grammar_prompts import _norm


def _result(correct: bool, answer: str, got: int = 0, total: int = 0) -> dict[str, Any]:
    """Build a grade result with a partial `score` (0..1) and a `detail` string.

    For multi-element types (build/blanks/dialog/match) `score` is the fraction of elements right,
    so a near-miss reads as encouraging progress rather than a flat fail. Single-answer types pass
    total=0 → score is just 0/1 with no detail. `correct` stays all-or-nothing (full score)."""
    if total > 0:
        score = got / total
        return {"correct": correct, "correct_answer": answer, "score": score, "detail": f"{got}/{total}"}
    return {"correct": correct, "correct_answer": answer, "score": 1.0 if correct else 0.0, "detail": ""}


def grade(sealed: dict[str, Any], response: Any) -> dict[str, Any]:
    """Grade an interactive answer against the unsealed token.
    Returns {correct, correct_answer, score, detail}."""
    kind = sealed.get("t")

    if kind in ("multiple-choice", "odd-one-out"):
        answer = str(sealed.get("answer") or "")
        return _result(_norm(response) == _norm(answer), answer)

    if kind == "multiple-blanks":
        answers = [str(a) for a in (sealed.get("answers") or [])]
        picks = response if isinstance(response, list) else []
        got = sum(1 for p, a in zip(picks, answers) if _norm(p) == _norm(a))
        correct = len(picks) == len(answers) and got == len(answers)
        return _result(correct, ", ".join(answers), got, len(answers))

    if kind == "order-the-dialog":
        order = [str(line) for line in (sealed.get("order") or [])]
        picks = response if isinstance(response, list) else []
        # Partial credit = lines placed in their correct position.
        got = sum(1 for p, o in zip(picks, order) if _norm(p) == _norm(o))
        correct = len(picks) == len(order) and got == len(order)
        return _result(correct, " → ".join(order), got, len(order))

    if kind == "build-the-sentence":
        sentence = str(sealed.get("sentence") or "")
        target_words = sentence.split()
        got_words = str(response).split() if not isinstance(response, (list, dict)) else []
        # Partial credit = words in the correct position.
        got = sum(1 for a, b in zip(got_words, target_words) if _norm(a) == _norm(b))
        correct = _norm(response) == _norm(sentence)
        return _result(correct, sentence, got, len(target_words))

    if kind == "tap-the-error":
        try:
            idx = int(response)
        except (TypeError, ValueError):
            idx = -1
        return _result(idx == int(sealed.get("index", -1)), str(sealed.get("answer") or ""))

    if kind == "match-pairs":
        ids = sealed.get("ids") or []
        # Correct iff every left id is mapped to itself (right items carry their correct left's id).
        mapping = response if isinstance(response, dict) else {}
        got = sum(1 for i in ids if str(i) in mapping and int(mapping[str(i)]) == int(i))
        correct = len(mapping) == len(ids) and got == len(ids)
        return _result(correct, str(sealed.get("answer") or ""), got, len(ids))

    # Unknown/forged kind.
    return _result(False, "")
