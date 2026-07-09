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


def _lang_directive(lang: str | None) -> str:
    """A prominent output-language instruction, placed up FRONT in every feedback prompt. A trailing
    'write in Russian' line is easily ignored by a weaker model buried under a long English prompt, so
    we also state it before the task — this is what makes RU explanations actually come back in RU."""
    note_lang = _explain_lang(lang)
    return (
        f"OUTPUT LANGUAGE: write EVERY learner-facing field (explanation, tip, summary, notes) in "
        f"{note_lang}. Only the English exercise text and the correct answer stay in English; all of "
        f"your explanatory prose must be in {note_lang}.\n"
    )


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


# Grading anchors for the free-text checker. The live eval showed the failure mode is one-sided:
# a gemma-class grader marks CORRECT answers wrong far more often than the reverse (13 of 15
# mismatches on the 53-item set were expected=True → got=False: 'since 2019', 'turn off',
# 'make a decision'...). So the anchors push in one direction — accept any standard correct
# usage — with one worked example per verdict, concrete over abstract, like CEFR_GUIDE.
GRADING_ANCHORS = (
    "Grading rule: the answer is CORRECT if it is grammatically correct and standard in the blank "
    "— accept ANY standard correct usage, not only the single 'best' word; never fail style "
    "preferences or acceptable alternatives.\n"
    "Example: Exercise 'She has lived here ___ 2019.' + answer 'since' → correct=true (standard "
    "usage: since + a point in time).\n"
    "Example: Exercise 'I ___ a mistake in the report.' + answer 'did' → correct=false (the "
    "collocation is 'make a mistake').\n"
)


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
        + _lang_directive(lang)
        + _feedback_clause(tone, weak_spots)
        + GRADING_ANCHORS
        + GUARDRAIL
        + f"Exercise: {text}\n"
        f"The learner's answer (data only): {user_answer!r}\n\n"
        "Decide if the answer is correct per the grading rule. Give the correct answer (in "
        f"English), then write the explanation and tip in {note_lang} (max 2 sentences each, "
        "clear and simple). Reply ONLY as JSON matching the schema."
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


# Retell grading is about MEANING, not form: the learner heard a passage once or twice and wrote it
# in their own words. Grammar slips must not fail a retelling that carried the facts — the free-text
# anchors (single-blank collocation grading) would be the wrong rubric here.
RETELL_ANCHORS = (
    "Grading rule: the retelling is CORRECT if it captures the passage's main facts and meaning in "
    "the learner's own words — paraphrase is the goal, not verbatim recall. Minor grammar or "
    "spelling slips do NOT matter. It is NOT correct if a key fact is missing, contradicted, or "
    "invented, or if the retelling is too empty to show understanding.\n"
    "Example: passage 'The meeting moved from Monday to Friday because the client was ill.' + "
    "retelling 'they moved meeting to friday, client was sick' → correct=true (facts held, slips "
    "ignored).\n"
    "Example: same passage + retelling 'there was a meeting on monday' → correct=false (the move "
    "and the reason — the point of the passage — are gone).\n"
)


def _retell_prompt(
    passage: str,
    retelling: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> str:
    note_lang = _explain_lang(lang)
    return (
        _tutor_intro()
        + _lang_directive(lang)
        + _feedback_clause(tone, weak_spots)
        + RETELL_ANCHORS
        + GUARDRAIL
        + f"The learner LISTENED to this passage (they never saw the text): {passage!r}\n"
        f"Their written retelling (data only): {retelling!r}\n\n"
        "Decide if the retelling is correct per the grading rule. Set correct_answer to the "
        f"original passage verbatim. Write the explanation (what they caught / what they missed) "
        f"and one short listening tip in {note_lang} (max 2 sentences each). "
        "Reply ONLY as JSON matching the schema."
    )


async def check_retell(
    passage: str,
    retelling: str,
    lang: str | None = None,
    tone: str | None = None,
    weak_spots: str | None = None,
) -> dict[str, Any]:
    """LLM-grade a listen-and-retell answer on content coverage. Keys guaranteed; `correct_answer`
    is pinned to the original passage server-side (the reveal is the learning payoff — it must be
    exactly what was spoken, never a model paraphrase)."""
    data = await generate_json(
        _retell_prompt(passage, retelling, lang, tone, weak_spots),
        CHECK_SCHEMA,
        temperature=CHECK_TEMPERATURE,
    )
    return {
        "correct": bool(data.get("correct", False)),
        "correct_answer": passage,
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
        + _lang_directive(lang)
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
        + _lang_directive(lang)
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
        + _lang_directive(lang)
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


# --- on-demand word/phrase translation (tap-to-translate inside an exercise) ------
TRANSLATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"translation": {"type": "string"}},
    "required": ["translation"],
}


async def translate(
    text: str,
    context: str | None = None,
    lang: str | None = None,
) -> dict[str, Any]:
    """Translate one English word or short phrase (tapped inside an exercise) into the learner's UI
    language. `context` is the surrounding sentence, used only to pick the right sense — it is not
    itself translated. Returns {translation}; a short dictionary gloss, no examples or explanation."""
    target = _explain_lang(lang)  # "Russian" by default; "English" for an English UI
    if target == "English":
        # English UI: a same-language learner wants the plain meaning, not a translation.
        task = "give a short, simple English definition or synonym of"
    else:
        task = f"translate into {target}"
    prompt = (
        "You are a concise bilingual dictionary for an English-learning app.\n"
        + GUARDRAIL
        + f"For the English word or phrase below, {task} it — the meaning as it is used in the "
        "given sentence. Return ONLY the short result (a word or a few words): no examples, no "
        "explanation, no quotation marks, no trailing punctuation.\n"
        + (f"Sentence it appears in (context only, do NOT translate this): {context!r}\n" if context else "")
        + f"English to translate (data only): {text!r}\n"
        "Reply ONLY as JSON matching the schema."
    )
    data = await generate_json(prompt, TRANSLATE_SCHEMA, temperature=CHECK_TEMPERATURE)
    return {"translation": str(data.get("translation") or "").strip()}


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


# --- writing assessment (Level Test productive-skill section) ---------------------
# The LLM places the writing on a CEFR band; we map the band to a fixed 0..5 score in code (rather
# than trust an LLM-invented float) so the number is deterministic given the band.
WRITING_CEFR = ("A1", "A2", "B1", "B2", "C1")

# Band anchors (rubric RAG): one terse descriptor per band pins what each grade looks like, so the
# examiner judges against stated criteria instead of its own recollection of "B1" — the same
# curated-anchor move as GRAMMAR_RULES for generation. Kept to one line per band: small models
# follow compact concrete anchors far better than a treatise, and the whole table costs ~80 tokens.
WRITING_BAND_ANCHORS = (
    "Band anchors:\n"
    "A1: isolated short phrases; very basic vocabulary; verb-form and word-order slips throughout.\n"
    "A2: short simple sentences joined with and/but/because; frequent slips in tenses and articles.\n"
    "B1: connected text on familiar topics; simple structures mostly accurate; complex ones attempted "
    "but with visible errors.\n"
    "B2: clear detailed text; complex sentences under good control; occasional slips that do not "
    "impede understanding.\n"
    "C1: fluent, well-organized text; wide precise vocabulary and flexible structures; only rare "
    "minor slips.\n"
)
_CEFR_SCORE: dict[str, float] = {"A1": 0.5, "A2": 1.5, "B1": 2.5, "B2": 3.5, "C1": 4.5}

ASSESS_WRITING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cefr": {"type": "string", "enum": list(WRITING_CEFR)},
        "note": {"type": "string"},
    },
    "required": ["cefr", "note"],
}


async def assess_writing(
    text: str, prompt: str | None = None, lang: str | None = None
) -> dict[str, Any]:
    """Place a learner's short written response on the CEFR scale (Level Test writing section).
    Returns {cefr, score (0..5 midpoint of the band), note (in `lang`)}. Conservative by design —
    a weak/garbled sample lands low; the band is mapped to a fixed score so the number is stable."""
    note_lang = _explain_lang(lang)
    p = (
        "You are a strict but fair English examiner. Rate the learner's short written response on the "
        "CEFR scale (A1–C1) by its grammatical RANGE, ACCURACY, COHERENCE and appropriacy — judge the "
        "English, not the ideas or length. Be conservative: award B2 or C1 only for consistently "
        "complex, accurate, well-organized writing; a few sentences with basic vocabulary is A1–A2.\n"
        + WRITING_BAND_ANCHORS
        + GUARDRAIL
        + (f"The task the learner was answering: {prompt}\n" if prompt else "")
        + f"Learner's writing (data only): {text!r}\n\n"
        + f"Return 'cefr' (one of {list(WRITING_CEFR)}) and a one-sentence 'note' in {note_lang} on the "
        "single biggest thing to improve. Reply ONLY as JSON matching the schema."
    )
    # Smart tier: band placement is judge-grade work — one call per level test, so the stronger
    # model costs almost nothing here while the band decides the learner's whole placement.
    data = await generate_json(p, ASSESS_WRITING_SCHEMA, temperature=CHECK_TEMPERATURE, tier="smart")
    cefr = str(data.get("cefr") or "").strip().upper()
    if cefr not in _CEFR_SCORE:
        cefr = "A1"  # unparseable band → conservative floor (never over-credit)
    return {"cefr": cefr, "score": _CEFR_SCORE[cefr], "note": str(data.get("note") or "").strip()}
