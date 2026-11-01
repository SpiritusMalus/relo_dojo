"""Small, authored safety net after AI candidates fail validation.

These are practice items, not CEFR certification. The returned level belongs to the
actual item: a B2 safety-net question must never be scored as the requested C1.
Provider policy/configuration failures do not select this bank. No user input is
sent anywhere by this module, and keys remain inside the normal sealed token.
"""
from __future__ import annotations

from dataclasses import dataclass
from random import SystemRandom
from typing import Any

from . import tokens


@dataclass(frozen=True)
class Item:
    topic: str
    level: str
    text: str
    answer: str
    distractors: tuple[str, str, str]


# Context/meaning requirements are displayed, not hidden in the answer key. Deliberately
# avoid stylistic alternatives, optional backshift and modal choices without a stated meaning.
BANK: tuple[Item, ...] = (
    Item("articles", "A1", "She bought ___ umbrella.", "an", ("a", "these", "many")),
    Item("articles", "B2", "Complete the fixed expression: In ___ long run, regular practice helps.", "the", ("a", "an", "each")),
    Item("prepositions", "A1", "The workshop starts ___ Monday.", "on", ("at", "of", "between")),
    Item("prepositions", "B2", "Complete the standard verb pattern: They objected ___ paying an extra fee.", "to", ("for", "at", "with")),
    Item("conditionals", "A2", "Use the first conditional: If it rains tomorrow, we ___ indoors.", "will stay", ("would stayed", "staying", "has stayed")),
    Item("conditionals", "B2", "Use a completed unreal past result: If she had received the message yesterday, she ___ immediately.", "would have replied", ("has replied", "will reply", "replies")),
    Item("verb sequence (tense agreement)", "A2", "Use the past simple with yesterday: The team ___ the report yesterday.", "finished", ("finishes", "has finished", "will finish")),
    Item("verb sequence (tense agreement)", "B1", "Use backshift to report 'I am tired': He said that he ___ tired.", "was", ("is", "has", "will")),
    Item("vocabulary", "A1", "She is a ___ (a person who teaches).", "teacher", ("window", "ticket", "garden")),
    Item("vocabulary", "B2", "She is a ___ investor (careful not to take risks).", "cautious", ("reckless", "unrelated", "annual")),
    Item("modal verbs", "A2", "You ___ park here (it is forbidden).", "must not", ("do not have to", "might", "should")),
    Item("modal verbs", "B2", "She ___ arrived home (a strong logical deduction about a completed past event).", "must have", ("should have", "might be", "can be")),
    Item("phrasal verbs", "A2", "Could you ___ the cat (take care of it)?", "look after", ("give up", "turn off", "run out")),
    Item("phrasal verbs", "B1", "They decided to ___ the meeting until Friday (postpone it).", "put off", ("carry out", "look into", "break down")),
    Item("gerunds & infinitives", "A2", "Complete the standard pattern: She enjoys ___ after work.", "swimming", ("to swim", "swim", "swims")),
    Item("gerunds & infinitives", "B2", "Complete the standard pattern: She admitted ___ the confidential file.", "copying", ("to copy", "copy", "copied")),
    Item("comparatives & superlatives", "A2", "This box weighs 10 kg; that box weighs 5 kg. This box is ___ than that one.", "heavier", ("heaviest", "heavy", "most heavy")),
    Item("comparatives & superlatives", "B2", "The more you practise, ___ your answers become.", "the more accurate", ("more accurater", "the most accurate", "most accurate")),
    Item("word order", "A1", "Choose the normal statement word order: ___", "She plays tennis.", ("Plays she tennis.", "Tennis plays she.", "She tennis plays.")),
    Item("word order", "A2", "Choose the normal question word order: ___", "Where do you work?", ("Where you do work?", "Where do work you?", "You where do work?")),
    Item("word order", "B1", "Complete the indirect question: Could you tell me ___?", "where the station is", ("where is the station", "where does the station", "where the station does")),
    Item("punctuation", "A2", "Write a list of three separate items (tea / bread / milk): ___", "We bought tea, bread and milk.", ("We bought tea bread and milk.", "We bought, tea bread and milk.", "We bought tea bread and, milk.")),
    Item("punctuation", "B2", "Choose standard written punctuation for two clauses joined by however: ___", "It was raining; however, we went out.", ("It was raining, however we went out.", "It was raining however, we went out.", "It was raining; however we went out.")),
)

_BANDS = ("A1", "A2", "B1", "B2", "C1")


def build_fallback(topic: str, level: str | None, practice_index: int | None = None) -> dict[str, Any] | None:
    candidates = [item for item in BANK if item.topic == topic]
    if not candidates:
        return None
    requested = _BANDS.index(level) if level in _BANDS else 1
    accessible = [item for item in candidates if _BANDS.index(item.level) <= requested]
    # A manually selected advanced topic can have a minimum level above the requested band;
    # keep that real level visible instead of relabelling the task as A1.
    pool = accessible or candidates
    target = max(_BANDS.index(item.level) for item in pool) if accessible else min(_BANDS.index(item.level) for item in pool)
    pool = [item for item in pool if _BANDS.index(item.level) == target]
    item = pool[max(0, practice_index or 0) % len(pool)]
    options = [item.answer, *item.distractors]
    SystemRandom().shuffle(options)
    return {
        "type": "multiple-choice", "topic": topic, "level": item.level,
        "text": item.text, "options": options, "source": "curated",
        "token": tokens.seal({"t": "multiple-choice", "answer": item.answer,
                              "topic": topic, "text": item.text}),
    }
