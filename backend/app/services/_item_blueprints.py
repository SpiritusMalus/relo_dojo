"""Key-first item construction: the grammatical decision is made by OUR rule, never asserted by the
model.

Everywhere else in this codebase the model writes the sentence AND declares which answer is correct,
and we can only sanity-check the shape of what came back. That is the hole every dogfood defect has
come through: a well-formed item whose key is wrong or whose distractors also fit (prod 2026-07-19,
"The developer ___ fixes..." with often/always — both correct, so the learner was graded on a coin
flip).

Here the order is inverted. We pin the slot and the cue that decides it ("... on Monday ..."), the
model only writes a natural sentence around that phrase, and then the key is *computed* from our own
rule. The model has no authority over correctness, so it cannot get correctness wrong — the worst it
can do is write a sentence that fails the frame check, which we reject.

That trade only works where the rule is genuinely decidable by a machine. Days take 'on', clock
times take 'at', 'an' goes before a vowel SOUND — those are computable. Definiteness ('the' vs 'a'),
dialog coherence and "which word is odd" are not, and deliberately have no blueprints here.

Pure module: no LLM calls, no I/O — every function below is unit-testable on its own.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from ._grammar_prompts import _strip_word

# --- the decided item -------------------------------------------------------


@dataclass(frozen=True)
class BlueprintItem:
    """One fully decided item: `sentence[index]` is the slot, `answer` is provably right there and
    every entry in `distractors` provably wrong — both follow from `rule`, not from the model."""

    sentence: list[str]
    index: int
    answer: str
    distractors: tuple[str, ...]
    rule: str


@dataclass(frozen=True)
class Blueprint:
    """A pinned frame handed to the model before it writes anything.

    `phrase` is the exact text the sentence must contain (e.g. "on Monday", "an hour"); `answer` is
    the word inside it that becomes the slot. `cue` names the check that proves the answer — see
    `_CUE_CHECKS`."""

    topic: str
    phrase: str
    answer: str
    distractors: tuple[str, ...]
    cue: str
    rule: str
    ask: str  # what the sentence should be about, in model-facing words


# --- prepositions of time ---------------------------------------------------
# Within the closed set {in, on, at} these three rules are absolute, which is what makes the
# distractors provably wrong rather than merely unlikely.

_DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
_DAYPARTS = ("morning", "afternoon", "evening")
_CLOCK_TIMES = ("6 am", "7:30", "9 am", "10:15", "2 pm", "5:45", "6 pm", "11 pm")

_PREP_RULE_DAY = "Days and dates take 'on': on Monday, on 5 May."
_PREP_RULE_CLOCK = "Clock times take 'at': at 6 pm, at 7:30."
_PREP_RULE_MONTH = "Months and years take 'in': in May, in 2024."
_PREP_RULE_DAYPART = "Parts of the day take 'in': in the morning (but 'at night')."


def _preposition_blueprints() -> list[Blueprint]:
    """The frames we can prove. One per cue kind, with the cue value sampled for variety."""
    day = random.choice(_DAYS)
    month = random.choice(_MONTHS)
    clock = random.choice(_CLOCK_TIMES)
    year = str(random.choice((2019, 2021, 2022, 2023, 2024)))
    part = random.choice(_DAYPARTS)
    return [
        Blueprint("prepositions", f"on {day}", "on", ("in", "at"), "day", _PREP_RULE_DAY,
                  f"something that happens on {day}"),
        Blueprint("prepositions", f"at {clock}", "at", ("in", "on"), "clock", _PREP_RULE_CLOCK,
                  f"something that happens at {clock}"),
        Blueprint("prepositions", f"in {month}", "in", ("on", "at"), "month", _PREP_RULE_MONTH,
                  f"something that happened in {month}"),
        Blueprint("prepositions", f"in {year}", "in", ("on", "at"), "year", _PREP_RULE_MONTH,
                  f"something that happened in {year}"),
        Blueprint("prepositions", f"in the {part}", "in", ("on", "at"), "daypart", _PREP_RULE_DAYPART,
                  f"a routine that happens in the {part}"),
    ]


def _cue_day(words: list[str], i: int) -> bool:
    return i + 1 < len(words) and _strip_word(words[i + 1]).capitalize() in _DAYS


def _cue_clock(words: list[str], i: int) -> bool:
    if i + 1 >= len(words):
        return False
    nxt = _strip_word(words[i + 1])
    if re.fullmatch(r"\d{1,2}[:.]\d{2}", nxt):  # 7:30 — unambiguously a clock time on its own
        return True
    # A bare number is only a clock time when am/pm/o'clock follows ("in 6 hours" must not pass).
    after = _strip_word(words[i + 2]) if i + 2 < len(words) else ""
    return bool(re.fullmatch(r"\d{1,2}", nxt)) and after in {"am", "pm", "a.m.", "p.m.", "o'clock"}


def _cue_month(words: list[str], i: int) -> bool:
    if i + 1 >= len(words) or _strip_word(words[i + 1]).capitalize() not in _MONTHS:
        return False
    # "in May" takes 'in', but "on May 5" takes 'on' — a following date flips the rule, so refuse.
    after = _strip_word(words[i + 2]) if i + 2 < len(words) else ""
    return not after[:1].isdigit()


def _cue_year(words: list[str], i: int) -> bool:
    if i + 1 >= len(words):
        return False
    nxt = _strip_word(words[i + 1])
    return bool(re.fullmatch(r"(19|20)\d{2}", nxt))


def _cue_daypart(words: list[str], i: int) -> bool:
    if i + 2 >= len(words) or _strip_word(words[i + 1]) != "the":
        return False
    if _strip_word(words[i + 2]) not in _DAYPARTS:
        return False
    # "on the morning OF the launch" is correct English — a following 'of' flips the rule, so refuse.
    after = _strip_word(words[i + 3]) if i + 3 < len(words) else ""
    if after == "of":
        return False
    # "on Monday morning" is also correct — a day right before the slot flips it too.
    prev = _strip_word(words[i - 1]).capitalize() if i > 0 else ""
    return prev not in _DAYS


# --- articles: 'a' vs 'an' --------------------------------------------------
# Decided by the SOUND of the next word, which is computable with two small exception lists. ('the'
# is deliberately absent: definiteness depends on shared context, so no rule of ours can settle it.)

# Consonant letter, vowel sound → 'an'.
_VOWEL_SOUND = frozenset({"hour", "hours", "honest", "honestly", "honour", "honor", "heir", "x-ray"})
# Vowel letter, consonant sound → 'a'.
_CONSONANT_SOUND = frozenset({
    "university", "universal", "unit", "uniform", "union", "unique", "user", "useful", "usual",
    "european", "one", "once", "utility",
})

_ARTICLE_RULE = "'a/an' is chosen by the SOUND that follows: an hour, a university, an old server."

# Pinned noun phrases: a mix of ordinary and sound-trap heads, so the drill hits the cases where the
# spelling and the sound disagree — exactly where a RU speaker (and a small model) slips.
_ARTICLE_PHRASES = (
    "hour", "honest mistake", "university degree", "unique opportunity", "useful tool",
    "urgent request", "old server", "email", "engineer", "umbrella", "hospital", "unusual error",
)


def article_for(phrase: str) -> str:
    """'a' or 'an' for what follows it — by sound, not by spelling. Only the FIRST word decides:
    it is "an honest mistake" (heard vowel) but "a university degree" (heard consonant)."""
    head = str(phrase).split()
    key = _strip_word(head[0]) if head else ""
    if key in _VOWEL_SOUND:
        return "an"
    if key in _CONSONANT_SOUND:
        return "a"
    return "an" if key[:1] in "aeiou" else "a"


def _article_blueprints() -> list[Blueprint]:
    out: list[Blueprint] = []
    for head in random.sample(_ARTICLE_PHRASES, k=min(4, len(_ARTICLE_PHRASES))):
        answer = article_for(head)
        wrong = "a" if answer == "an" else "an"
        out.append(
            Blueprint("articles", f"{answer} {head}", answer, (wrong,), "article", _ARTICLE_RULE,
                      f"a situation involving {answer} {head}")
        )
    return out


def _cue_article(words: list[str], i: int) -> bool:
    """The slot is right iff our sound rule, applied to the following word, agrees with it."""
    return i + 1 < len(words) and article_for(words[i + 1]) == _strip_word(words[i])


_CUE_CHECKS = {
    "day": _cue_day,
    "clock": _cue_clock,
    "month": _cue_month,
    "year": _cue_year,
    "daypart": _cue_daypart,
    "article": _cue_article,
}

# Topics whose canon we can decide ourselves. Everything else keeps the model-authored path until it
# gets a blueprint of its own.
BLUEPRINT_TOPICS = frozenset({"prepositions", "articles"})


def pick(topic: str) -> Blueprint | None:
    """A random pinned frame for the topic, or None when the topic has no decidable canon."""
    if topic == "prepositions":
        return random.choice(_preposition_blueprints())
    if topic == "articles":
        return random.choice(_article_blueprints())
    return None


def build(bp: Blueprint, sentence: str) -> BlueprintItem | None:
    """Turn the model's sentence into a decided item, or None when it doesn't honor the frame.

    Rejects rather than repairs: a sentence that drifted off the pinned phrase is one whose key we
    can no longer prove, and an unprovable item is exactly what this module exists to stop shipping.
    """
    words = sentence.split()
    target = _strip_word(bp.answer)
    # Find the slot: the pinned answer word placed where the cue check passes. Scanning (instead of
    # trusting a substring hit) also handles the model reusing the word elsewhere in the sentence.
    check = _CUE_CHECKS[bp.cue]
    hits = [i for i, w in enumerate(words) if _strip_word(w) == target and check(words, i)]
    if len(hits) != 1:
        return None  # frame missing, or ambiguous — two provable slots means two right taps
    index = hits[0]
    # The slot gets swapped for a blank or for a planted error, so the token must be the bare word:
    # attached punctuation ("on,") would be destroyed by the swap, and a sentence-initial slot would
    # render a lowercase option ("in") against a capitalized original ("In").
    if index == 0 or words[index] != target:
        return None
    return BlueprintItem(words, index, target, bp.distractors, bp.rule)


def wrong_word_for(item: BlueprintItem) -> str | None:
    """A distractor usable as a planted error: it must not already appear in the sentence, or the
    learner cannot tell which copy is the wrong one (the tap-the-error invariant)."""
    present = {_strip_word(w) for i, w in enumerate(item.sentence) if i != item.index}
    for d in item.distractors:
        if _strip_word(d) not in present:
            return d
    return None
