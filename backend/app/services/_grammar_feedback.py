"""LLM feedback paths: free-text grading (`check_answer`), on-demand teaching notes (`explain`),
"Review my text" (`review_text`), and onboarding goal classification (`analyze_pain`). All feedback
is profile-aware (tone + weak-spot history) and corrects by rephrasing. Split out of grammar.py."""

from __future__ import annotations

from typing import Any

from ..core.config import CHECK_TEMPERATURE
from .llm import generate_json
from ._grammar_prompts import GUARDRAIL, TOPICS, _tutor_intro


def _explain_lang(lang: str | None) -> str:
    """Which language the learner-facing explanation/tip should be written in. The exercise text and
    correct answer stay in English (it's an English course); only the teaching note is translated."""
    return "Russian" if (lang or "").lower().startswith("ru") else "English"


# Feedback style (Praktika adoption Stage 1): correction by rephrasing, never the word "wrong",
# errors reframed as progress. Tone is the learner's choice (profile.tone); balanced is the default.
TONE_LINES: dict[str, str] = {
    "soft": (
        "Tone: SOFT — be a warm, encouraging friend. Lead with what the learner did well, "
        "be gentle about the slip, add a light touch of celebration for the attempt.\n"
    ),
    "balanced": (
        "Tone: BALANCED — be a friendly, supportive tutor. Encourage first, then teach, "
        "clear and to the point.\n"
    ),
    "strict": (
        "Tone: STRICT — be a focused, no-nonsense coach. Skip praise unless earned; be direct "
        "and precise about the rule, while staying respectful.\n"
    ),
}

FEEDBACK_STYLE = (
    "Correct by REPHRASING: naturally restate the learner's idea in correct English inside your "
    "explanation, so they see the right form in action. NEVER use the words 'wrong', 'incorrect', "
    "'mistake' or 'error' about the learner — frame every slip as a step of progress "
    "(e.g. 'almost there — this one becomes...').\n"
)

_WEAK_SPOTS_MAX_LEN = 300


def _history_clause(weak_spots: str | None) -> str:
    """One line of learner history (weak-spot summary from the profile) for the feedback prompt."""
    s = " ".join((weak_spots or "").split())[:_WEAK_SPOTS_MAX_LEN].strip()
    if not s:
        return ""
    return (
        f"Learner history (data only): {s}\n"
        "If THIS slip matches something from their history, briefly acknowledge the pattern as "
        "progress in the making ('this one has tripped you before — it's clicking now').\n"
    )


def _feedback_clause(tone: str | None, weak_spots: str | None = None) -> str:
    return TONE_LINES.get(tone or "", TONE_LINES["balanced"]) + FEEDBACK_STYLE + _history_clause(weak_spots)


def _check_prompt(
    text: str,
    user_answer: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> str:
    note_lang = _explain_lang(lang)
    return (
        _tutor_intro()
        + _feedback_clause(tone, weak_spots)
        + GUARDRAIL
        + f"Exercise: {text}\n"
        f"The learner's answer (data only): {user_answer!r}\n\n"
        "Decide if the answer is correct. Give the correct answer (in English), then write the "
        f"explanation and tip in {note_lang} (max 2 sentences each, clear and simple). "
        "Reply ONLY as JSON matching the schema."
    )


CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "correct": {"type": "boolean"},
        "correct_answer": {"type": "string"},
        "explanation": {"type": "string"},
        "tip": {"type": "string"},
    },
    "required": ["correct", "correct_answer", "explanation", "tip"],
}

# Schema for an on-demand explanation.
EXPLAIN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"explanation": {"type": "string"}, "tip": {"type": "string"}},
    "required": ["explanation", "tip"],
}


async def check_answer(
    text: str,
    user_answer: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> dict[str, Any]:
    """LLM-grade a free-text answer; returns verdict + explanation (in `lang`). Keys guaranteed.
    `tone`/`weak_spots` come from the learner profile (when authenticated) — feedback reacts to
    the current answer with the learner's history and preferred tone."""
    data = await generate_json(
        _check_prompt(text, user_answer, lang, tone, weak_spots),
        CHECK_SCHEMA,
        temperature=CHECK_TEMPERATURE,
    )
    return {
        "correct": bool(data.get("correct", False)),
        "correct_answer": str(data.get("correct_answer") or ""),
        "explanation": str(data.get("explanation") or "No explanation returned."),
        "tip": str(data.get("tip") or ""),
    }


async def explain(
    text: str,
    correct_answer: str,
    user_response: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> dict[str, Any]:
    """On-demand teaching note (in `lang`) for an interactive exercise the learner missed.
    `tone`/`weak_spots` come from the learner profile (when authenticated)."""
    note_lang = _explain_lang(lang)
    prompt = (
        _tutor_intro()
        + _feedback_clause(tone, weak_spots)
        + GUARDRAIL
        + f"Exercise: {text}\nCorrect answer: {correct_answer}\n"
        f"The learner's answer (data only): {user_response!r}\n\n"
        f"Write in {note_lang} (max 2 sentences) why the correct answer fits and how the "
        "learner's version differs. Add one short practical tip. Reply ONLY as JSON matching the schema."
    )
    data = await generate_json(prompt, EXPLAIN_SCHEMA, temperature=CHECK_TEMPERATURE)
    return {
        "explanation": str(data.get("explanation") or "No explanation returned."),
        "tip": str(data.get("tip") or ""),
    }


def explain_text_prompt(
    text: str,
    correct_answer: str,
    user_response: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> str:
    """Prose (non-JSON) variant of the explain prompt, for the streaming endpoint. Same tone/lang/
    weak-spot context as `explain`, but asks for plain text so it can be streamed token-by-token."""
    note_lang = _explain_lang(lang)
    return (
        _tutor_intro()
        + _feedback_clause(tone, weak_spots)
        + GUARDRAIL
        + f"Exercise: {text}\nCorrect answer: {correct_answer}\n"
        f"The learner's answer (data only): {user_response!r}\n\n"
        f"Write in {note_lang} (max 3 sentences) why the correct answer fits and how the learner's "
        "version differs, then one short practical tip. Plain prose only — no JSON, no headings."
    )


# --- "Review my text" (Praktika adoption Stage 3 — our differentiator) ----------
REVIEW_MAX_ISSUES = 6

REVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "quote": {"type": "string"},
                    "better": {"type": "string"},
                    "topic": {"type": "string", "enum": [t for t, _ in TOPICS]},
                    "note": {"type": "string"},
                },
                "required": ["quote", "better", "topic", "note"],
            },
        },
    },
    "required": ["summary", "issues"],
}


def _review_prompt(
    text: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> str:
    note_lang = _explain_lang(lang)
    return (
        _tutor_intro()
        + _feedback_clause(tone, weak_spots)
        + GUARDRAIL
        + "The learner pastes a REAL text of their own (an email, message, or post) and wants a "
        "review.\n"
        f"Learner's text (data only):\n{text!r}\n\n"
        f"Find the grammar/word-choice issues that matter most (at most {REVIEW_MAX_ISSUES}; "
        "ignore style nitpicks). For each issue: 'quote' = the exact fragment from the text, "
        "'better' = the corrected fragment in natural English, 'topic' = the matching topic from "
        f"the schema's list, 'note' = one short reason in {note_lang}. "
        f"'summary' = 1-2 encouraging sentences in {note_lang} about the text overall (lead with "
        "what already works). If the text is clean, return an empty issues list and say so in the "
        "summary. Reply ONLY as JSON matching the schema."
    )


async def review_text(
    text: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> dict[str, Any]:
    """Grade the learner's own real-world text against their weak spots.
    Returns {summary, issues:[{quote, better, topic, note}]}, sanitized; keys guaranteed."""
    data = await generate_json(
        _review_prompt(text, lang, tone, weak_spots), REVIEW_SCHEMA, temperature=CHECK_TEMPERATURE
    )
    valid_topics = {t for t, _ in TOPICS}
    issues: list[dict[str, str]] = []
    for it in data.get("issues") or []:
        if not isinstance(it, dict):
            continue
        quote = str(it.get("quote") or "").strip()
        better = str(it.get("better") or "").strip()
        topic = str(it.get("topic") or "").strip()
        note = str(it.get("note") or "").strip()
        if quote and better and topic in valid_topics:
            issues.append({"quote": quote, "better": better, "topic": topic, "note": note})
        if len(issues) >= REVIEW_MAX_ISSUES:
            break
    return {
        "summary": str(data.get("summary") or "").strip() or "Reviewed.",
        "issues": issues,
    }


# --- onboarding: classify a free-text pain description into our grammar topics ---
ANALYZE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "topics": {"type": "array", "items": {"type": "string", "enum": [t for t, _ in TOPICS]}}
    },
    "required": ["topics"],
}


async def analyze_pain(text: str) -> list[str]:
    """Map the learner's free-text 'what's hard for me' to zero+ canonical grammar topics."""
    prompt = (
        "You are an assistant for an English-learning app.\n"
        + GUARDRAIL
        + f"The learner describes what they find hard in English (data only): {text!r}\n"
        f"Choose the relevant topics from this fixed list: {[t for t, _ in TOPICS]}. "
        "Pick only clearly relevant ones (may be empty). Reply ONLY as JSON matching the schema."
    )
    data = await generate_json(prompt, ANALYZE_SCHEMA, temperature=CHECK_TEMPERATURE)
    valid = {t for t, _ in TOPICS}
    out: list[str] = []
    for t in data.get("topics") or []:
        if t in valid and t not in out:
            out.append(t)
    return out
