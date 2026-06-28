"""Grammar exercise generation, deterministic grading & LLM explanations (Phase 2.5).

This module is the stable public facade for the grammar domain. The implementation is split by
concern into sibling modules — kept here as a single import surface so callers and tests keep using
`grammar.<name>` unchanged:

- `_grammar_prompts`   — topic/type mixes, CEFR difficulty, prompt-clause builders, repair helpers.
- `_grammar_generators`— per-type exercise generators + `generate_exercise` (sealed-token answers).
- `_grammar_grading`   — deterministic `grade` for interactive types (no LLM).
- `_grammar_feedback`  — LLM paths: `check_answer`, `explain`, `review_text`, `analyze_pain`.

Most exercises are interactive (tap-based) with deterministic answers, so the LLM only *generates*
them — grading happens in Python (`grade`), instant and reliable. The correct answer is sealed into
a token (see `tokens.py`) so it never reaches the client until revealed on a wrong answer.
"""

from __future__ import annotations

# --- prompt foundation (constants, clause builders, repair helpers) ---
from ._grammar_prompts import (
    CEFR_GUIDE,
    EXERCISE_TYPES,
    GUARDRAIL,
    MAX_MISTAKE_HINTS,
    MC_LEN_SLACK,
    SCENARIO,
    TOPICS,
    _cefr,
    _context_clause,
    _level_clause,
    _max_words,
    _MISTAKE_MAX_LEN,
    _mistakes_clause,
    _norm,
    _normalize_blanks,
    _resolve_odd,
    _sanitize_mistakes,
    _strip_word,
    _tutor_intro,
    _weighted,
    pick_topic,
)

# --- exercise generators + dispatcher ---
from ._grammar_generators import (
    BUILD_SCHEMA,
    ERROR_SCHEMA,
    FREETEXT_SCHEMA,
    MATCH_SCHEMA,
    MC_SCHEMA,
    MULTI_BLANK_SCHEMA,
    ODD_ONE_OUT_SCHEMA,
    ORDER_DIALOG_SCHEMA,
    _ENABLED_TYPES,
    _GENERATORS,
    _TOPIC_NAMES,
    _gen_build_the_sentence,
    _gen_free_text,
    _gen_match_pairs,
    _gen_multiple_blanks,
    _gen_multiple_choice,
    _gen_odd_one_out,
    _gen_order_the_dialog,
    _gen_tap_the_error,
    generate_exercise,
)

# --- deterministic grading ---
from ._grammar_grading import _result, grade

# --- LLM feedback paths ---
from ._grammar_feedback import (
    ANALYZE_SCHEMA,
    CHECK_SCHEMA,
    EXPLAIN_SCHEMA,
    FEEDBACK_STYLE,
    REVIEW_MAX_ISSUES,
    REVIEW_SCHEMA,
    TONE_LINES,
    _check_prompt,
    _explain_lang,
    _feedback_clause,
    _history_clause,
    _review_prompt,
    analyze_pain,
    assess_writing,
    check_answer,
    explain,
    explain_text_prompt,
    review_text,
)

# The "one exception across providers" re-export some callers expect from this module.
from .llm import LLMError as OllamaError

__all__ = [
    "OllamaError",
    "GUARDRAIL",
    "TOPICS",
    "EXERCISE_TYPES",
    "pick_topic",
    "generate_exercise",
    "grade",
    "check_answer",
    "explain",
    "review_text",
    "analyze_pain",
    "assess_writing",
    "TONE_LINES",
    "FEEDBACK_STYLE",
    "REVIEW_MAX_ISSUES",
    "MAX_MISTAKE_HINTS",
]
