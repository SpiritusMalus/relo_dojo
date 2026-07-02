"""Curated lexical bank (lightweight RAG for the word-choice topics).

The grammar reference (_grammar_rules) grounds STRUCTURAL topics with a rule, but the two lexical
topics — 'vocabulary' and 'phrasal verbs' — need units, not rules: which collocation, which
confusable pair, which particle. That is exactly where a small model's memory is least reliable,
and where RU-speaker interference bites hardest (false friends, make/do, say/tell). Sampling a few
curated units into the generation prompt grounds the item in vetted content AND varies it between
calls — the sample IS the variety mechanism.

Terse by design, like GRAMMAR_RULES: each unit is one compact line the model can copy from safely.
Units are keyed by CEFR band letter (A/B/C); an unknown band falls back to B (the app default).
"""

from __future__ import annotations

import random

from ._grammar_rules import _band

VOCAB_BANK: dict[str, list[str]] = {
    "A": [
        "make vs do: make a decision / a mistake / friends; do homework / the dishes / sport",
        "say vs tell: say something; tell SOMEONE something — 'She told me', never 'She said me'",
        "'advice', 'information', 'money' are uncountable: some advice, never 'an advice' or 'advices'",
        "'I agree' — agree is a verb, never 'I'm agree'",
        "fun vs funny: fun = enjoyable ('the trip was fun'); funny = makes you laugh",
        "come vs go: come = toward the speaker/listener, go = away ('I'm coming to your office')",
        "watch vs look at vs see: watch TV; look at a photo; see a friend",
        "borrow vs lend: I borrow FROM you; you lend TO me",
    ],
    "B": [
        "actual(ly) is a false friend of 'актуальный': it means 'real, in fact' — for 'currently "
        "relevant' use relevant/topical",
        "opportunity vs possibility: an opportunity is a chance to DO something ('a job opportunity')",
        "make a decision / take a break / pay attention / have an impact — fixed collocations",
        "raise vs rise: raise takes an object ('raise a question'); rise does not ('prices rise')",
        "remind vs remember: remind SOMEONE to do it; remember it yourself",
        "'in the end' (finally, after everything) vs 'at the end' (of a period or place)",
        "'контролировать' a process is usually monitor/oversee in English — 'control' implies command",
        "affect (verb) vs effect (noun): 'it affects users'; 'it has an effect on users'",
    ],
    "C": [
        "comprehensive (thorough) vs comprehensible (understandable)",
        "economic (of the economy) vs economical (cheap to run)",
        "'sympathetic' is a false friend of 'симпатичный': it means compassionate — for looks use "
        "likeable/attractive",
        "draw a conclusion / reach a compromise / bear responsibility / meet a deadline — advanced "
        "collocations",
        "sensible (reasonable) vs sensitive (easily affected)",
        "reporting verbs grade the claim: admit / insist / imply / acknowledge — each changes its strength",
    ],
}

PHRASAL_BANK: dict[str, list[str]] = {
    "A": [
        "turn on / turn off (separable): 'turn the light off' = 'turn it off'",
        "get up, wake up, sit down, stand up — daily-routine phrasals, no object",
        "look for (inseparable) = search: 'I'm looking for my keys'",
        "put on / take off clothes (separable): 'put your coat on' = 'put it on'",
    ],
    "B": [
        "figure out (separable) = understand or solve: 'figure the bug out' = 'figure it out'",
        "run into (inseparable) = meet by chance: 'I ran into a colleague'",
        "look after (inseparable) = take care of; look into = investigate",
        "give up (separable) = quit; take up = start a hobby",
        "set up (separable) = arrange or install: 'set up a meeting', 'set it up'",
        "put off (separable) = postpone: 'put the call off' = 'put it off'",
    ],
    "C": [
        "put up with (three-part, inseparable) = tolerate: 'put up with the noise'",
        "get around to (three-part) = finally do: 'I never got around to it'",
        "come up with = invent an idea; come down with = fall ill",
        "follow through on = complete what you promised; fall back on = use as a reserve",
        "phase out (separable) = retire gradually: 'phase the old API out'",
    ],
}

LEXICAL_BANKS: dict[str, dict[str, list[str]]] = {
    "vocabulary": VOCAB_BANK,
    "phrasal verbs": PHRASAL_BANK,
}

MAX_LEXICAL_UNITS = 3


def lexical_clause(topic: str | None, level: str | None = None, rng: random.Random | None = None) -> str:
    """For a lexical topic, a prompt clause carrying a small random sample of curated units the item
    must be built from; '' for structural topics (their anchor is the grammar rule instead).
    `rng` pins the sample in tests; production uses the module RNG like the topic/type mixes."""
    bank = LEXICAL_BANKS.get((topic or "").strip())
    if bank is None:
        return ""
    units = bank.get(_band(level)) or bank["B"]
    picked = (rng or random).sample(units, min(MAX_LEXICAL_UNITS, len(units)))
    listed = " ".join(f"({i}) {u}." for i, u in enumerate(picked, 1))
    return (
        f"Curated word bank (vetted): {listed}\n"
        "Build the exercise around exactly ONE of these units, keeping its word choice as given; "
        "distractors may draw on the others.\n"
    )
