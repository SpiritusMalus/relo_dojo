"""Curated grammar reference (lightweight RAG for generation).

A short, authoritative rule + worked examples per canonical topic, injected into the generation
prompt so correctness comes from this reference instead of a small model's memory — which is exactly
where gemma-class models slip (conditionals, articles, tense agreement). Keys MUST match the
canonical topic strings in `_grammar_prompts.TOPICS`.

Deliberately terse: small models follow a compact, concrete reference far better than a long
treatise, and a tight clause keeps token cost — and the model's habit of copying the prompt — low.
"""

from __future__ import annotations

GRAMMAR_RULES: dict[str, str] = {
    "prepositions": (
        "Time: 'at' clock times, 'on' days/dates, 'in' months/years/parts of day. "
        "Place: 'at' a point, 'on' a surface/line, 'in' an enclosed area. "
        "e.g. 'at 6 pm on Monday in May'; 'in the room, at the door'."
    ),
    "conditionals": (
        "Zero: if + present, present (general truth). First: if + present, will + base (real future). "
        "Second: if + past, would + base (unreal present). Third: if + past perfect, would have + past "
        "participle (unreal past). Never put 'will'/'would' in the if-clause. "
        "e.g. 'If it rains, we will stay'; 'If I had known, I would have called'."
    ),
    "verb sequence (tense agreement)": (
        "Keep tenses consistent; backshift in reported speech (say→said, will→would, present→past). "
        "After a past main verb the subordinate clause is usually past too. "
        "e.g. 'She said she was tired' (not 'is tired')."
    ),
    "vocabulary": (
        "Use the natural collocation, register and word form (noun/verb/adj); watch false friends. "
        "e.g. 'make a decision' (not 'do a decision'); 'advice' is uncountable."
    ),
    "articles": (
        "'a/an' = first mention / one of many ('an' before a vowel SOUND); 'the' = specific/known/unique; "
        "no article with general plurals and uncountables. "
        "e.g. 'a university', 'an hour', 'the sun', 'I like music'."
    ),
    "modal verbs": (
        "Modal + bare infinitive (no 'to', no -s). must/have to = obligation, should = advice, "
        "can/could = ability/permission, may/might = possibility, would = hypothetical. "
        "e.g. 'She can swim'; 'You should rest'."
    ),
    "phrasal verbs": (
        "verb + particle, usually idiomatic. Separable: object can go between ('turn the light off' / "
        "'turn it off'). Inseparable: it cannot ('look after them', 'run into a friend')."
    ),
    "gerunds & infinitives": (
        "After prepositions and verbs like enjoy/avoid/finish → -ing; after want/need/decide/hope and "
        "most adjectives → to + base; some (start/like) take either. "
        "e.g. 'enjoy reading'; 'decide to leave'."
    ),
    "comparatives & superlatives": (
        "Short adj: -er/-est (bigger, the biggest). Long adj: more/most (more useful, the most useful). "
        "Irregular: good→better→best, bad→worse→worst. Use 'than' with comparatives, 'the' with superlatives."
    ),
    "word order": (
        "Statements are Subject–Verb–Object. Adverbs of frequency go before the main verb but after 'be'. "
        "Adjective order: opinion–size–age–shape–colour–origin–material. "
        "e.g. 'She often reads'; 'a small old wooden box'."
    ),
    "punctuation": (
        "Comma after an introductory clause and between list items; apostrophe for possession/contraction "
        "('its' = possessive, 'it's' = it is); capitalize sentence starts and proper nouns. "
        "e.g. 'After lunch, we left'; 'the dog's bone'."
    ),
}


# Per-band refinements: (topic, band) → the rule scoped to what that CEFR band actually drills.
# Band is the CEFR letter (A = A1/A2, B = B1/B2, C = C1). Only topics whose canon genuinely differs
# by band get entries; every other (topic, band) falls back to the base GRAMMAR_RULES clause. This
# keeps an A-level prompt free of third-conditional noise and a C-level prompt free of basics — a
# smaller, sharper anchor for the level being practiced (and fewer tokens, not more).
GRAMMAR_RULES_BY_BAND: dict[tuple[str, str], str] = {
    ("conditionals", "A"): (
        "Zero: if + present, present (general truth). First: if + present, will + base (real future). "
        "Never put 'will' in the if-clause. "
        "e.g. 'If it rains, we will stay home'."
    ),
    ("conditionals", "B"): (
        "Second: if + past, would + base (unreal present). Third: if + past perfect, would have + past "
        "participle (unreal past). Never put 'would' in the if-clause. "
        "e.g. 'If I had known, I would have called'."
    ),
    ("conditionals", "C"): (
        "Mixed: if + past perfect, would + base (past cause, present result) and the reverse. Formal "
        "inversion drops 'if': 'Had I known...', 'Were we to...', 'Should you need...'. "
        "e.g. 'Had we left earlier, we would be home by now'."
    ),
    ("modal verbs", "A"): (
        "Modal + bare infinitive (no 'to', no -s). can/can't = ability or permission, must = obligation, "
        "should = advice. "
        "e.g. 'She can swim'; 'You should rest'."
    ),
    ("modal verbs", "C"): (
        "Perfect modals for deduction and hindsight: must have / can't have / might have + past "
        "participle; should have = regret; needn't have done = did it, but it wasn't necessary. "
        "e.g. 'She must have left'; 'You needn't have paid'."
    ),
    ("gerunds & infinitives", "A"): (
        "like/love/hate/enjoy + -ing; want/need/decide + to + base. "
        "e.g. 'I enjoy reading'; 'I want to go'."
    ),
    ("gerunds & infinitives", "C"): (
        "Meaning switches: stop/remember/forget/regret/try change meaning with -ing vs to + base. "
        "e.g. 'I stopped smoking' (quit) vs 'I stopped to smoke' (paused in order to)."
    ),
    ("comparatives & superlatives", "C"): (
        "Parallel increase: 'the + comparative..., the + comparative...'. Grade the gap with "
        "far/much/slightly; 'not nearly as ... as'. "
        "e.g. 'The earlier we deploy, the safer the release'; 'far more reliable than'."
    ),
}


def _band(level: str | None) -> str:
    """CEFR letter band ('A'/'B'/'C') from a level like 'B1'; '' when absent or off-scale."""
    letter = (level or "").strip()[:1].upper()
    return letter if letter in {"A", "B", "C"} else ""


def rules_clause(topic: str | None, level: str | None = None) -> str:
    """A prompt clause stating the authoritative rule for `topic` — sharpened to the CEFR band when
    a per-band refinement exists, else the base rule. Empty for an unknown/blank topic (so off-canon
    topics simply fall back to the model's own knowledge — no failure)."""
    t = (topic or "").strip()
    rule = GRAMMAR_RULES_BY_BAND.get((t, _band(level))) or GRAMMAR_RULES.get(t)
    if not rule:
        return ""
    return (
        f"Authoritative rule for {topic} (follow it exactly; the exercise and its correct answer MUST "
        f"be consistent with this rule): {rule}\n"
    )
