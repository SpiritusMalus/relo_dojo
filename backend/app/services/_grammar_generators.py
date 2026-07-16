"""Per-type exercise generators + the public `generate_exercise` dispatcher. Each generator asks
the model for structured JSON, validates/repairs it, and returns the client payload with the answer
sealed into a token (tokens.py) — never in plaintext. Split out of the former grammar.py."""

from __future__ import annotations

import logging
import random
from contextvars import ContextVar
from typing import Any

from ..core.config import EXERCISE_TEMPERATURE
from . import tokens
from ._grammar_feedback import _explain_lang
from .llm import LLMError as OllamaError
from .llm import LLMRefusedError, LLMTimeoutError, generate_json
from ._grammar_prompts import (
    EXERCISE_TYPES,
    MC_LEN_SLACK,
    TOPICS,
    _cefr,
    _max_words,
    _norm,
    _normalize_blanks,
    _resolve_odd,
    _strip_word,
    _tutor_intro,
    _weighted,
    pick_topic,
)

logger = logging.getLogger(__name__)

# Feedback-retry channel: when a generator rejects the model's output, the reason lands here and
# the dispatcher feeds it into the NEXT attempt's prompt — a targeted "fix exactly this" beats a
# blind identical retry. ContextVar so concurrent generations (parallel story beats) can't cross.
_last_reject: ContextVar[str] = ContextVar("last_reject", default="")


def _reject(reason: str) -> None:
    """Record + log why an output was unusable; call sites read `return _reject(...)`."""
    logger.info("generation rejected: %s", reason)
    _last_reject.set(reason)
    return None


def _retry_clause(note: str) -> str:
    """Prompt prefix for a retry after a rejection: tell the model exactly what to fix."""
    if not note:
        return ""
    return f"IMPORTANT — your previous output was rejected: {note}. Fix exactly that this time.\n"


# --- JSON schemas the model must fill (one per type) -------------------------
MC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "answer": {"type": "string"},
    },
    "required": ["text", "options", "answer"],
}
BUILD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentence_en": {"type": "string"},
        "sentence_ru": {"type": "string"},
        "distractors": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sentence_en", "sentence_ru"],
}
MATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pairs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"left": {"type": "string"}, "right": {"type": "string"}},
                "required": ["left", "right"],
            },
        }
    },
    "required": ["pairs"],
}
ERROR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentence": {"type": "string"},
        "wrong_word": {"type": "string"},
        "correction": {"type": "string"},
    },
    "required": ["sentence", "wrong_word", "correction"],
}
FREETEXT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
}
ODD_ONE_OUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {"type": "array", "items": {"type": "string"}},
        "odd": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["items", "odd", "reason"],
}
MULTI_BLANK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "blanks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer": {"type": "string"},
                },
                "required": ["options", "answer"],
            },
        },
    },
    "required": ["text", "blanks"],
}
ORDER_DIALOG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": {"type": "string"}}},
    "required": ["lines"],
}
TRANSFORM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "instruction": {"type": "string"},
        "source": {"type": "string"},
        "target": {"type": "string"},
    },
    "required": ["instruction", "source", "target"],
}
LISTEN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "passage": {"type": "string"},
        "question": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "answer": {"type": "string"},
    },
    "required": ["passage", "question", "options", "answer"],
}
RETELL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"passage": {"type": "string"}},
    "required": ["passage"],
}


def _trap_tiles(raw: Any, sentence_words: list[str], cap: int = 2) -> list[str]:
    """Validated distractor tiles for word-bank exercises: extra words that go in the bank but
    never in the answer. Keeps only short tokens that don't already occur in the sentence
    (punctuation-stripped, case-insensitive) — a duplicate of a real word adds confusion, not
    difficulty. Empty input degrades gracefully to a no-distractor card."""
    seen = {_strip_word(w) for w in sentence_words}
    out: list[str] = []
    for d in raw or []:
        word = str(d).strip().strip(".,!?;:'\"()")
        key = _strip_word(word)
        if not key or key in seen or len(word.split()) > 2:
            continue
        seen.add(key)
        out.append(word)
        if len(out) >= cap:
            break
    return out


# --- per-type generators -----------------------------------------------------
# Each returns the client payload (no answer) plus a sealed `token` carrying the answer.


async def _gen_multiple_choice(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE short multiple-choice exercise focused on: {topic}.\n"
        "'text' is a sentence with a single blank shown as '___'. 'options' is 3-4 short choices "
        "(make the distractors plausible and close in meaning at higher CEFR levels). "
        "'answer' is exactly one of the options (the correct one). "
        "When a field/context is given, draw the example from it; otherwise use a clear everyday situation. "
        "Reply ONLY as JSON matching the schema.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, MC_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    text = str(data.get("text") or "").strip()
    options = [str(o).strip() for o in (data.get("options") or []) if str(o).strip()]
    answer = str(data.get("answer") or "").strip()
    # Need a real choice set with the answer present. The word cap is a readability preference,
    # not correctness — allow a slack so a slightly long sentence isn't thrown away (and retried).
    if not text or len(options) < 2 or not answer:
        return _reject("multiple-choice: missing text, options or answer")
    if len(text.split()) > _max_words(level) + MC_LEN_SLACK:
        return _reject(f"multiple-choice: sentence over {_max_words(level)} words — write a shorter one")
    if _norm(answer) not in {_norm(o) for o in options}:
        options.append(answer)  # model forgot to include the answer — add it
    random.shuffle(options)
    # Sealed extras: `topic` (+ `text` where the item has a real drill sentence) ride in every token
    # so /check can log a miss server-side (services.miss_log). grade() reads only its own keys, so
    # older, leaner tokens keep grading unchanged.
    return {
        "type": "multiple-choice",
        "topic": topic,
        "text": text,
        "options": options[:6],
        "token": tokens.seal({"t": "multiple-choice", "answer": answer, "topic": topic, "text": text}),
    }


async def _gen_build_the_sentence(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    # Translation exercise: show the Russian source, learner builds the English from word tiles.
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Write ONE correct English sentence (6 to 12 words; longer and more complex at higher CEFR "
        f"levels) that illustrates: {topic}, then give its natural Russian translation.\n"
        "'sentence_en' is the English sentence (plain words, at most one comma, end with a period). "
        "'sentence_ru' is its Russian translation. "
        "'distractors' is 1-2 extra WRONG word tiles: broken forms of words already in the sentence "
        "(wrong tense, wrong number, wrong article — e.g. 'goes' when the sentence uses 'go'). Each "
        "must NOT fit anywhere in the sentence and must never be a correct alternative. "
        "Draw the example from the learner's field when one is given; otherwise a clear everyday situation. "
        "Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, BUILD_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    sentence = str(data.get("sentence_en") or "").strip()
    sentence_ru = str(data.get("sentence_ru") or "").strip()
    words = sentence.split()
    if not sentence_ru:
        return _reject("build-the-sentence: missing the Russian translation")
    if len(words) < 3 or len(words) > _max_words(level):
        return _reject(f"build-the-sentence: the English sentence must be 3 to {_max_words(level)} words")
    tiles = words[:]
    # Shuffle until the order actually changes (so it isn't already solved).
    for _ in range(8):
        random.shuffle(tiles)
        if tiles != words:
            break
    return {
        "type": "build-the-sentence",
        "topic": topic,
        "text": "Translate into English:",
        "prompt": sentence_ru,
        "tiles": tiles,
        # Trap tiles (client mixes them into the bank): without them the bank is exactly the
        # answer's words and assembling degenerates into using everything up.
        "distractors": _trap_tiles(data.get("distractors"), words),
        "token": tokens.seal({"t": "build-the-sentence", "sentence": sentence, "topic": topic}),
    }


async def _gen_match_pairs(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create 3 or 4 matching pairs to practice: {topic}.\n"
        "Each 'left' MUST be a short sentence containing exactly one blank shown as '___'. "
        "Each 'right' is the single word/phrase that fills that blank (it must actually complete the "
        "sentence). ALL 'right' values must be DIFFERENT words — never repeat the same right value, "
        "or the matching becomes a guessing game. Keep each side under 6 words. Pairs must be "
        "unambiguous. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, MATCH_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    raw = data.get("pairs") or []
    pairs: list[dict[str, str]] = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        left = str(p.get("left") or "").strip()
        right = str(p.get("right") or "").strip()
        if left and right and "___" in left:  # left must have a blank to fill
            pairs.append({"left": left, "right": right})
    # Both sides must be UNIQUE (normalized): two visually identical right tiles ("will" twice)
    # make the matching a coin flip — the learner cannot know which physical tile "belongs" to
    # which sentence. Prod screenshot 2026-07-03: text-correct answers graded 2/4 exactly this way.
    seen_left: set[str] = set()
    seen_right: set[str] = set()
    unique: list[dict[str, str]] = []
    for p in pairs:
        nl, nr = _norm(p["left"]), _norm(p["right"])
        if nl in seen_left or nr in seen_right:
            continue
        seen_left.add(nl)
        seen_right.add(nr)
        unique.append(p)
    if len(unique) < 3:
        return _reject(
            "match-pairs: need 3+ pairs where every 'left' has exactly one '___' and ALL 'right' values are DIFFERENT words"
        )
    pairs = unique[:4]
    left_items = [{"id": i, "text": p["left"]} for i, p in enumerate(pairs)]
    # Right ids are the SHUFFLED positions — opaque. (They used to equal the matching left's id,
    # which put the full answer key in the client payload; the true mapping now lives only in the
    # sealed token, with the rights' texts so identical tiles could still grade as interchangeable.)
    shuffled = pairs[:]
    random.shuffle(shuffled)
    right_items = [{"id": j, "text": p["right"]} for j, p in enumerate(shuffled)]
    mapping = {str(i): shuffled.index(p) for i, p in enumerate(pairs)}
    # One pair per line: the reveal renders as a tidy list, not a "; "-glued blob.
    correct_answer = "\n".join(f"{p['left']} → {p['right']}" for p in pairs)
    return {
        "type": "match-pairs",
        "topic": topic,
        "text": "Match each item with its pair.",
        "left": left_items,
        "right": right_items,
        "token": tokens.seal(
            {
                "t": "match-pairs",
                "map": mapping,
                "rights": {str(j): _norm(p["right"]) for j, p in enumerate(shuffled)},
                "answer": correct_answer,
                "topic": topic,
            }
        ),
    }


async def _gen_tap_the_error(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Write ONE English sentence (6 to 12 words) containing exactly ONE grammatically wrong "
        f"word, related to: {topic}.\n"
        "'sentence' is that sentence. 'wrong_word' is the single incorrect word as it appears in the "
        "sentence. 'correction' is the word that should replace it. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, ERROR_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    sentence = str(data.get("sentence") or "").strip()
    wrong_word = str(data.get("wrong_word") or "").strip()
    correction = str(data.get("correction") or "").strip()
    words = sentence.split()
    if not wrong_word or not correction:
        return _reject("tap-the-error: missing wrong_word or correction")
    if len(words) < 3 or len(words) > _max_words(level):
        return _reject(f"tap-the-error: the sentence must be 3 to {_max_words(level)} words")
    # Locate the wrong word among the tokens (punctuation-insensitive, first match).
    target = _strip_word(wrong_word)
    error_index = next((i for i, w in enumerate(words) if _strip_word(w) == target), -1)
    if error_index < 0:
        return _reject("tap-the-error: wrong_word does not appear verbatim in the sentence")
    # The fix must be a real substitution: the correction has to differ from the wrong word, and it
    # must not already sit elsewhere in the sentence — otherwise "correcting" it produces a duplicate
    # (e.g. "...update frequently usually..." with wrong='frequently'→'usually'), which reads as broken.
    corr_norm = _strip_word(correction)
    if corr_norm == target:
        return _reject("tap-the-error: correction must differ from the wrong word")
    if any(i != error_index and _strip_word(w) == corr_norm for i, w in enumerate(words)):
        return _reject("tap-the-error: correction already appears elsewhere in the sentence")
    return {
        "type": "tap-the-error",
        "topic": topic,
        "text": "Tap the word that is wrong.",
        "tokens": words,
        "token": tokens.seal(
            {
                "t": "tap-the-error",
                "index": error_index,
                "answer": f"'{words[error_index]}' → '{correction}'",
                "topic": topic,
                "text": sentence,
            }
        ),
    }


async def _gen_free_text(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE short 'fill the gap' exercise focused on: {topic}.\n"
        "'text' is a single sentence with a blank shown as '___' that the learner types the missing "
        "word(s) into. Use an example from the learner's field when given, else everyday. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, FREETEXT_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    text = str(data.get("text") or "").strip()
    if not text:
        return _reject("free-text: empty text")
    # No token: free-text is graded by the LLM via check_answer().
    return {"type": "free-text", "topic": topic, "text": text, "token": None}


async def _gen_odd_one_out(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE 'odd one out' exercise to practice: {topic}.\n"
        "'items' is 4 short words or phrases; exactly ONE does not belong with the others (by grammar "
        "category, collocation, or meaning relevant to the topic). 'odd' is exactly that item (it MUST "
        "appear verbatim in 'items'). 'reason' is a brief why. Keep items under 4 words each. "
        "Flavor it with the learner's field when given, else everyday. Reply ONLY as JSON matching the schema.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, ODD_ONE_OUT_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    items = [str(o).strip() for o in (data.get("items") or []) if str(o).strip()]
    odd = str(data.get("odd") or "").strip()
    # Need a real set; the 'odd' value must resolve to one of the items (verbatim or a unique
    # near-match — the model often paraphrases it). Re-pin to the matched item so the sealed
    # answer is exactly an option.
    if len(items) < 3 or not odd:
        return _reject("odd-one-out: need 4 items and an 'odd' value")
    matched = _resolve_odd(odd, items)
    if matched is None:
        return _reject("odd-one-out: 'odd' must be exactly one of the items, verbatim")
    odd = matched
    items = items[:6]
    random.shuffle(items)
    return {
        "type": "odd-one-out",
        "topic": topic,
        "text": "Tap the one that doesn't belong.",
        "options": items,
        "token": tokens.seal({"t": "odd-one-out", "answer": odd, "topic": topic}),
    }


async def _gen_multiple_blanks(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE fill-the-gaps exercise with 2 to 5 blanks to practice: {topic}.\n"
        "'text' is one short sentence (or two for 4-5 blanks) — use more blanks only if it stays "
        "natural; show each blank as '___' (use the literal three underscores). "
        "'blanks' has one entry PER blank, in left-to-right order: 'options' is 2-3 short choices and "
        "'answer' is the correct one (it MUST be one of the options). The number of '___' in 'text' "
        "MUST equal the number of blanks. Use the learner's field when given, else everyday. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, MULTI_BLANK_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    # Normalize stray underscore runs ('____', '__') to exactly '___' so the blank count lines up.
    text = _normalize_blanks(str(data.get("text") or "").strip())
    raw = data.get("blanks") or []
    blank_options: list[list[str]] = []
    answers: list[str] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        opts = [str(o).strip() for o in (b.get("options") or []) if str(o).strip()]
        ans = str(b.get("answer") or "").strip()
        if len(opts) < 2 or not ans:
            continue
        if _norm(ans) not in {_norm(o) for o in opts}:
            opts.append(ans)  # ensure the answer is selectable
        random.shuffle(opts)
        blank_options.append(opts[:4])
        answers.append(ans)
    # Need 2-5 blanks and the '___' count in the sentence to match exactly (so the UI lines up).
    if not (2 <= len(answers) <= 5) or text.count("___") != len(answers):
        return _reject("multiple-blanks: the number of '___' in text must equal the number of blanks (2-5)")
    if len(text.split()) > _max_words(level) + len(answers):
        return _reject("multiple-blanks: text too long for the level — write a shorter sentence")
    return {
        "type": "multiple-blanks",
        "topic": topic,
        "text": text,
        "blankOptions": blank_options,
        "token": tokens.seal({"t": "multiple-blanks", "answers": answers, "topic": topic, "text": text}),
    }


async def _gen_order_the_dialog(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    # Per-line word cap scales with CEFR (short turns early, longer at B2/C1).
    per_line = _max_words(level)
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE dialog of 4 to 8 lines that, in the correct order, forms a coherent "
        f"conversation and naturally practices: {topic}.\n"
        f"'lines' is the dialog IN THE CORRECT ORDER (each line a single turn, under {per_line} words). "
        "The lines must make sense in EXACTLY ONE order — build strong cohesion: open with a greeting or "
        "question, put every answer after its question, and only use back-references ('it', 'that', "
        "'then', 'sure') after the thing they point to. Avoid lines that could stand in more than one "
        "position. The LAST line must close the conversation — a reply, confirmation, or sign-off, "
        "never a dangling question left unanswered. "
        "Set it in the learner's field when given, else everyday. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, ORDER_DIALOG_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    lines = [str(line).strip() for line in (data.get("lines") or []) if str(line).strip()]
    # Need 4-8 distinct lines for a richer, still-unambiguous ordering task.
    if not (4 <= len(lines) <= 8) or len({_norm(line) for line in lines}) != len(lines):
        return _reject("order-the-dialog: need 4 to 8 lines, all distinct")
    # The opening line is given to the learner as a foothold; they order the remaining lines. This
    # cuts blind guessing on the first move and reads more like a real "continue the chat" task. The
    # sealed order still holds ALL lines (anchor at index 0), so grading is unchanged — the client
    # submits [anchor, ...their order].
    anchor, rest = lines[0], lines[1:]
    tiles = rest[:]
    for _ in range(8):
        random.shuffle(tiles)
        if tiles != rest:
            break
    return {
        "type": "order-the-dialog",
        "topic": topic,
        "text": "Put the conversation in the right order.",
        "anchor": anchor,
        "tiles": tiles,
        "token": tokens.seal({"t": "order-the-dialog", "order": lines, "topic": topic}),
    }


# Closed word-classes where a one-word swap is best drilled as a focused "pick the right word" gap,
# not by rebuilding the whole sentence tile-by-tile (dogfood 2026-07: changing 'in'→'on' in a
# 10-word sentence meant re-assembling all 10 tiles for a single decision). If BOTH the wrong word
# and its fix live in the same set, we render the transform as a one-blank multiple-choice.
_CONFUSABLE_SETS: tuple[frozenset[str], ...] = (
    frozenset({"in", "on", "at", "by", "to", "for", "of", "from", "with", "into", "over", "under", "about"}),
    frozenset({"a", "an", "the"}),
    frozenset({"this", "that", "these", "those"}),
    frozenset({"some", "any", "much", "many", "few", "little", "a lot"}),
    frozenset({"since", "for", "ago", "during", "while"}),
    frozenset({"do", "does", "did", "done", "doing"}),
    frozenset({"is", "are", "was", "were", "am", "be", "been", "being"}),
    frozenset({"has", "have", "had", "having"}),
    frozenset({"and", "but", "or", "so", "because", "although"}),
)


def _single_swap_gap(source_words: list[str], target_words: list[str]) -> tuple[str, list[str], str] | None:
    """If source→target differs by exactly one aligned, same-class word, return (blank_text, options,
    answer) for a one-blank multiple-choice; else None (keep the full tile-builder)."""
    if len(source_words) != len(target_words):
        return None
    diffs = [i for i, (s, w) in enumerate(zip(source_words, target_words)) if _norm(s) != _norm(w)]
    if len(diffs) != 1:
        return None
    i = diffs[0]
    correct, wrong = target_words[i], source_words[i]
    cn, wn = _strip_word(correct), _strip_word(wrong)
    pool = next((s for s in _CONFUSABLE_SETS if cn in s and wn in s), None)
    if pool is None:
        return None
    # Options: correct + the original (now-wrong) word + fillers from the same class, up to 4.
    options = [correct, wrong]
    seen = {cn, wn}
    for w in sorted(pool):
        if len(options) >= 4:
            break
        if w not in seen:
            options.append(w)
            seen.add(w)
    random.shuffle(options)
    blanked = target_words[:]
    blanked[i] = "___"
    return " ".join(blanked), options, correct


async def _gen_transform_the_sentence(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    # Rewrite-the-sentence: show a source + a grammar instruction, learner builds the transformed
    # sentence from word tiles. Deterministically graded by word position (reuses build-the-sentence).
    # The 'instruction' is the only learner-facing prose, so it follows the UI language; the source
    # and target sentences stay English (it's an English course — that's the content being practiced).
    instr_lang = _explain_lang(lang)
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE sentence-transformation exercise that practices: {topic}.\n"
        f"'instruction' is a SHORT command, written in {instr_lang}, for one clear grammatical change "
        "(e.g. in English 'Rewrite in the past simple', 'Make it negative', 'Change to the passive', "
        "'Turn it into reported speech'). "
        "'source' is a correct English sentence. 'target' is the SINGLE correct result of applying the "
        "instruction to the source — there must be exactly one natural answer, and it must differ from "
        "the source. The 'source' and 'target' sentences are ALWAYS in English regardless of the "
        "instruction's language. Draw the example from the learner's field when one is given; otherwise "
        "a clear everyday situation. Reply ONLY as JSON.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, TRANSFORM_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    instruction = str(data.get("instruction") or "").strip()
    source = str(data.get("source") or "").strip()
    target = str(data.get("target") or "").strip()
    words = target.split()
    # Reject degenerate items: missing parts, a no-op transform, or a target outside the tile range.
    if not instruction or not source or not target or _norm(target) == _norm(source):
        return _reject("transform-the-sentence: missing parts, or the target equals the source")
    if len(words) < 3 or len(words) > _max_words(level):
        return _reject(f"transform-the-sentence: the target must be 3 to {_max_words(level)} words")
    # A one-word swap in a closed class (prepositions, articles, aux…) is a focused pick, not a
    # rebuild — render it as a single-blank multiple-choice (reuses MC grading + UI).
    gap = _single_swap_gap(source.split(), words)
    if gap is not None:
        text, options, answer = gap
        return {
            "type": "multiple-choice",
            "topic": topic,
            "text": text,
            "instruction": instruction,
            "options": options,
            "token": tokens.seal({"t": "multiple-choice", "answer": answer, "topic": topic, "text": text}),
        }
    tiles = words[:]
    # Shuffle until the order changes (so it isn't already solved).
    for _ in range(8):
        random.shuffle(tiles)
        if tiles != words:
            break
    return {
        "type": "transform-the-sentence",
        "topic": topic,
        "text": "Rewrite the sentence:",
        "instruction": instruction,
        "prompt": source,
        "tiles": tiles,
        # Trap tiles = the source words the transform dropped/replaced (deterministic diff, no LLM).
        # Without them a substitution transform arrives pre-solved: for "fix the preposition" over
        # "on 10 am" the bank held only the corrected 'at' (prod screenshot 2026-07-03), so the
        # learner had nothing to decide — now the discarded 'on' sits in the bank as the trap.
        "distractors": _trap_tiles(source.split(), words, cap=3),
        "token": tokens.seal({"t": "transform-the-sentence", "sentence": target, "topic": topic}),
    }


# --- listening comprehension (аудирование) -----------------------------------
# The passage is SPOKEN to the learner (client-side TTS reads `speak`; the text is never shown), so
# it must be plain speakable prose. Longer than a single drill sentence — the whole point is holding
# meaning in memory — but bounded per level so an A1 learner isn't read a paragraph.
_LISTEN_MIN_WORDS = 5


def _listen_max_words(level: str | None) -> int:
    return 4 * _max_words(level)


_LISTEN_PASSAGE_RULES = (
    "'passage' is a short spoken monologue of 2-4 sentences that will be read ALOUD to the learner "
    "(they never see the text), so write plain speakable prose: no headings, no quotes-heavy "
    "dialogue markup, no blanks ('___'), no parentheses. Weave in natural use of the topic.\n"
)


def _clean_listen_passage(raw: Any, level: str | None) -> str | None:
    """Validated spoken passage, or None (with the reject reason recorded) when unusable."""
    passage = " ".join(str(raw or "").split())
    words = passage.split()
    if len(words) < _LISTEN_MIN_WORDS:
        return _reject("listening: passage too short — write 2-4 full sentences")
    if len(words) > _listen_max_words(level):
        return _reject(f"listening: passage over {_listen_max_words(level)} words — write a shorter one")
    if "___" in passage:
        return _reject("listening: the passage must not contain blanks ('___')")
    return passage


async def _gen_listen_answer(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Create ONE listening-comprehension exercise to practice: {topic}.\n"
        + _LISTEN_PASSAGE_RULES
        + "'question' asks about ONE concrete fact from the passage (who/what/where/when/why — "
        "answerable only by someone who understood what was said, e.g. \"Was the door green or "
        "red?\"). 'options' is 3 short choices; the distractors must be plausible alternatives of "
        "the same kind (another color, another time, another place). 'answer' is exactly one of "
        "the options (the correct one). Use the learner's field when given, else everyday. "
        "Reply ONLY as JSON matching the schema.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, LISTEN_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    passage = _clean_listen_passage(data.get("passage"), level)
    if passage is None:
        return None
    question = " ".join(str(data.get("question") or "").split())
    options = [str(o).strip() for o in (data.get("options") or []) if str(o).strip()]
    answer = str(data.get("answer") or "").strip()
    if not question or "___" in question:
        return _reject("listening: missing a plain content question")
    if len(options) < 2 or not answer:
        return _reject("listening: need 3 options and an answer")
    if _norm(answer) not in {_norm(o) for o in options}:
        options.append(answer)  # model forgot to include the answer — add it
    random.shuffle(options)
    return {
        "type": "listen-and-answer",
        "topic": topic,
        "text": question,  # shown; the passage rides ONLY in `speak` (audio) + the sealed token
        "speak": passage,
        "options": options[:4],
        "token": tokens.seal({"t": "listen-and-answer", "answer": answer, "topic": topic, "text": passage}),
    }


async def _gen_listen_retell(topic: str, level: str | None = None, context: str | None = None, mistakes: list[str] | None = None, lang: str | None = None, retry_note: str = "") -> dict[str, Any] | None:
    prompt = _tutor_intro(
        _retry_clause(retry_note)
        + f"Write ONE short spoken passage for a listen-and-retell exercise practicing: {topic}.\n"
        + _LISTEN_PASSAGE_RULES
        + "It must carry 2-3 concrete facts a learner can retell in their own words (what happened, "
        "to whom, with what outcome). Use the learner's field when given, else everyday. "
        "Reply ONLY as JSON matching the schema.",
        level,
        context,
        mistakes,
        scenario=True,
        topic=topic,
    )
    data = await generate_json(prompt, RETELL_SCHEMA, temperature=EXERCISE_TEMPERATURE)
    passage = _clean_listen_passage(data.get("passage"), level)
    if passage is None:
        return None
    # `text` stays empty — the client shows its own localized "retell what you heard" instruction.
    # The passage is sealed so /check-retell grades against exactly what was generated (and the
    # endpoint stays usable only with our tokens, not as a free-form LLM proxy).
    return {
        "type": "listen-and-retell",
        "topic": topic,
        "text": "",
        "speak": passage,
        "token": tokens.seal({"t": "listen-and-retell", "passage": passage, "topic": topic}),
    }


_GENERATORS = {
    "multiple-choice": _gen_multiple_choice,
    "build-the-sentence": _gen_build_the_sentence,
    "match-pairs": _gen_match_pairs,
    "tap-the-error": _gen_tap_the_error,
    "odd-one-out": _gen_odd_one_out,
    "multiple-blanks": _gen_multiple_blanks,
    "order-the-dialog": _gen_order_the_dialog,
    "transform-the-sentence": _gen_transform_the_sentence,
    "free-text": _gen_free_text,
    "listen-and-answer": _gen_listen_answer,
    "listen-and-retell": _gen_listen_retell,
}


_TOPIC_NAMES = {t for t, _ in TOPICS}
_ENABLED_TYPES = {t for t, w in EXERCISE_TYPES if w > 0}
# Request-only types: a new client may ask for them explicitly, but the server never picks them
# from the weighted defaults (weight 0) — an older client can't render the audio card, so these
# must never arrive unsolicited.
_REQUESTABLE_TYPES = {"listen-and-answer", "listen-and-retell"}


async def generate_exercise(
    topic: str | None = None,
    level: str | None = None,
    ex_type: str | None = None,
    context: str | None = None,
    mistakes: list[str] | None = None,
    lang: str | None = None,
) -> dict[str, Any]:
    """Generate a new exercise. The client may steer topic/level/type (adaptive difficulty);
    anything invalid or omitted falls back to the weighted defaults.

    `lang` is the learner's UI language; it only affects LLM-generated task *instructions* (the
    transform-the-sentence command), so a Russian learner reads "Перепиши в прошедшем времени"
    rather than English. The exercise content (English sentences/options) is unaffected — it's an
    English course. Fixed instruction chrome for the other types is localized client-side.

    If a type's model output is unusable, fall back to multiple-choice; if even that fails, raise
    OllamaError (503) — never ship a broken card.
    """
    if topic not in _TOPIC_NAMES:
        topic = pick_topic()
    if ex_type not in _ENABLED_TYPES and ex_type not in _REQUESTABLE_TYPES:
        ex_type = _weighted(EXERCISE_TYPES)

    # Retry the chosen generator a few times (output may fail validation, e.g. too long for the
    # level), then fall back to multiple-choice — never ship a broken or over-hard item. Retries are
    # not blind: the rejection reason from the failed attempt is fed into the next prompt
    # (feedback-retry), so the model gets to fix the specific defect instead of rolling the dice.
    # A transient LLM failure (truncated JSON, an exhausted-5xx blip) spends an attempt the same way
    # a validation reject does — one flaky provider response must not 503 the card while a whole
    # retry+fallback ladder sits right here. Timeouts are the exception and re-raise immediately:
    # each already ate the full HTTP window, retrying stacks another one.
    # A guardrail refusal (403) is deterministic on the prompt — the provider flags the INPUT, so an
    # identical retry is refused again and again until the ladder is spent (prod 2026-07-03:
    # OpenRouter "PII detected (PERSON)" on a person name inside a quoted recent miss burned all 5
    # attempts and surfaced raw to the learner). After one refusal, drop the personalization clauses
    # (profile context + miss hints — the only user-derived text in the prompt) so the retry
    # actually changes the input; a generic on-topic card beats an error card.
    result = None
    note = ""
    last_exc: OllamaError | None = None
    refused = False
    for _ in range(3):
        try:
            result = await _GENERATORS[ex_type](
                topic, level, None if refused else context, None if refused else mistakes, lang, note
            )
            last_exc = None
        except LLMTimeoutError:
            raise
        except LLMRefusedError as exc:
            logger.warning("generation refused: type=%s topic=%s — retrying without personalization: %s", ex_type, topic, exc)
            result, last_exc, refused = None, exc, True
        except OllamaError as exc:
            logger.warning("generation attempt error: type=%s topic=%s: %s", ex_type, topic, exc)
            result, last_exc = None, exc
        if result is not None:
            break
        if last_exc is None:  # a validation reject left feedback; an LLM error has none to feed
            note = _last_reject.get()
    if result is None and ex_type != "multiple-choice":
        logger.info("generation fallback: %s unusable after retries (%s) — trying multiple-choice", ex_type, last_exc or note)
        note = ""  # the failed type's defect is meaningless to the fallback generator
        for _ in range(2):
            try:
                result = await _gen_multiple_choice(
                    topic, level, None if refused else context, None if refused else mistakes, lang, note
                )
                last_exc = None
            except LLMTimeoutError:
                raise
            except LLMRefusedError as exc:
                logger.warning("generation refused: type=multiple-choice topic=%s — retrying without personalization: %s", topic, exc)
                result, last_exc, refused = None, exc, True
            except OllamaError as exc:
                logger.warning("generation attempt error: type=multiple-choice topic=%s: %s", topic, exc)
                result, last_exc = None, exc
            if result is not None:
                break
            if last_exc is None:
                note = _last_reject.get()
    if result is None:
        logger.warning("generation failed: type=%s topic=%s level=%s (%s)", ex_type, topic, _cefr(level), last_exc or note)
        if last_exc is not None:
            raise last_exc  # every attempt died at the provider — surface its own reason, not a generic line
        raise OllamaError("The model produced an unusable exercise. Try again.")
    # Stamp the effective CEFR so the client can score the answer difficulty-aware (adaptive.ts).
    result["level"] = _cefr(level)
    return result
