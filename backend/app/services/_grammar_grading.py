"""Deterministic grading of interactive answers (the LLM-free /check path) — instant and reliable.
The correct answer is unsealed from the token (tokens.py) and compared in Python; the LLM never
gates correctness. Split out of the former grammar.py."""

from __future__ import annotations

from typing import Any

from ._grammar_prompts import _norm


def _result(
    correct: bool,
    answer: str,
    got: int = 0,
    total: int = 0,
    per_item: list[bool] | None = None,
    answer_items: list[str] | None = None,
) -> dict[str, Any]:
    """Build a grade result with a partial `score` (0..1), a `detail` string and per-element marks.

    For multi-element types (build/blanks/dialog/match) `score` is the fraction of elements right,
    so a near-miss reads as encouraging progress rather than a flat fail. Single-answer types pass
    total=0 → score is just 0/1 with no detail. `correct` stays all-or-nothing (full score).
    `per_item` (element order = the order shown to the learner) lets the client point at the exact
    rows that were wrong — "2/4" alone sends the learner hunting."""
    out: dict[str, Any] = {"correct": correct, "correct_answer": answer, "per_item": per_item or []}
    if answer_items is not None:
        out["answer_items"] = answer_items
    if total > 0:
        out.update(score=got / total, detail=f"{got}/{total}")
    else:
        out.update(score=1.0 if correct else 0.0, detail="")
    return out


def grade(sealed: dict[str, Any], response: Any) -> dict[str, Any]:
    """Grade an interactive answer against the unsealed token.
    Returns {correct, correct_answer, score, detail}."""
    kind = sealed.get("t")

    # listen-and-answer grades exactly like a multiple-choice pick — the listening happened
    # client-side (TTS); what reaches us is the tapped option vs the sealed answer.
    if kind in ("multiple-choice", "odd-one-out", "listen-and-answer"):
        answer = str(sealed.get("answer") or "")
        result = _result(_norm(response) == _norm(answer), answer)
        if kind == "odd-one-out" and isinstance(sealed.get("reason"), str):
            result["explanation"] = sealed["reason"]
        return result

    if kind == "multiple-blanks":
        answers = [str(a) for a in (sealed.get("answers") or [])]
        picks = response if isinstance(response, list) else []
        per = [i < len(picks) and _norm(picks[i]) == _norm(answers[i]) for i in range(len(answers))]
        got = sum(per)
        correct = len(picks) == len(answers) and got == len(answers)
        return _result(correct, ", ".join(answers), got, max(len(answers), len(picks)), per, answers)

    if kind == "order-the-dialog":
        order = [str(line) for line in (sealed.get("order") or [])]
        picks = response if isinstance(response, list) else []
        # Recent generated tokens without an explicit anchor still carried the topic. Older
        # unanchored keys without this metadata retain their original scoring.
        anchor = sealed.get("anchor", order[0] if order and sealed.get("topic") else None)
        answer_items = order
        anchor_matches = True
        if anchor:
            anchor_matches = bool(picks) and _norm(picks[0]) == _norm(anchor)
            answer_items = order[1:]
            picks = picks[1:]
        per = [anchor_matches and i < len(picks) and _norm(picks[i]) == _norm(line)
               for i, line in enumerate(answer_items)]
        got = sum(per)
        correct = bool(answer_items) and len(picks) == len(answer_items) and all(per)
        return _result(correct, " → ".join(order), got, max(len(answer_items), len(picks)), per, answer_items)

    if kind in ("build-the-sentence", "transform-the-sentence"):
        # transform-the-sentence builds a single target sentence from tiles, graded identically:
        # normalized full-match for `correct`, word-position partial credit otherwise.
        sentence = str(sealed.get("sentence") or "")
        target_words = sentence.split()
        got_words = str(response).split() if not isinstance(response, (list, dict)) else []
        # Partial credit = words in the correct position.
        got = sum(1 for a, b in zip(got_words, target_words) if _norm(a) == _norm(b))
        correct = bool(target_words) and _norm(response) == _norm(sentence)
        # Extra tiles are mistakes too. A wrong answer must not report a perfect adaptive score.
        return _result(correct, sentence, got, max(len(got_words), len(target_words)))

    if kind == "tap-the-error":
        try:
            idx = int(response)
        except (TypeError, ValueError):
            idx = -1
        return _result(idx == int(sealed.get("index", -1)), str(sealed.get("answer") or ""))

    if kind == "match-pairs":
        mapping = response if isinstance(response, dict) else {}
        key = sealed.get("map")
        if isinstance(key, dict):
            # Current tokens: right ids are opaque (shuffled positions) and the true left→right
            # mapping is sealed here, together with the rights' normalized texts. Two tiles with
            # identical text are interchangeable — the learner can't tell them apart, so picking
            # "the other will" must count (generation rejects duplicates, but sealed cards from any
            # other path stay fairly graded).
            rights = sealed.get("rights") or {}

            def _ok(left_id: str) -> bool:
                if left_id not in mapping:
                    return False
                chosen, want = str(mapping[left_id]), str(key[left_id])
                if chosen == want:
                    return True
                return rights.get(chosen) is not None and rights.get(chosen) == rights.get(want)

            per = [_ok(str(i)) for i in key]
            got = sum(per)
            correct = len(mapping) == len(key) and got == len(key)
            answer = str(sealed.get("answer") or "")
            answer_items = answer.splitlines()
            return _result(correct, answer, got, max(len(mapping), len(key)), per,
                           answer_items if len(answer_items) == len(per) else None)
        # Legacy tokens (pre opaque-ids): right items carried their correct left's id, so correct
        # iff every left id is mapped to itself.
        ids = sealed.get("ids") or []
        per = [str(i) in mapping and int(mapping[str(i)]) == int(i) for i in ids]
        got = sum(per)
        correct = len(mapping) == len(ids) and got == len(ids)
        return _result(correct, str(sealed.get("answer") or ""), got, len(ids), per_item=per)

    # Unknown/forged kind.
    return _result(False, "")
