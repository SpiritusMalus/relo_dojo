"""Grammar exercise generation & answer checking (Phase 2 learning core).

Prompt engineering lives here. The model produces structured JSON (forced via Ollama `format`),
so output is parseable. Examples are drawn from the developer's world when natural.
Topic mix is weighted toward the user's weak spots (handoff §4 Phase 2).
"""

from __future__ import annotations

import random
from typing import Any

from .ollama_client import generate_json

# (topic, weight) — weighted toward the user's weak spots.
TOPICS: list[tuple[str, int]] = [
    ("prepositions", 40),
    ("conditionals", 30),
    ("verb sequence (tense agreement)", 20),
    ("vocabulary", 10),
]

EXERCISE_TYPES = ["fill-the-gap", "correct-the-sentence", "choose-the-word"]

# JSON schema the model must fill when generating an exercise.
EXERCISE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": EXERCISE_TYPES},
        "text": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "answer": {"type": "string"},
    },
    "required": ["type", "text", "answer"],
}

# JSON schema for checking an answer.
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


def pick_topic() -> str:
    """Weighted-random topic from the user's priority mix."""
    topics, weights = zip(*TOPICS)
    return random.choices(topics, weights=weights, k=1)[0]


def _exercise_prompt(topic: str, ex_type: str) -> str:
    return (
        "You are an English grammar tutor for a Pre-Intermediate learner who is a Python developer.\n"
        f"Create ONE short '{ex_type}' exercise focused on: {topic}.\n"
        "When natural, use an example from the developer's world (code, docs, error messages).\n"
        "Rules by type:\n"
        "- fill-the-gap: 'text' is a sentence with a blank shown as '___'. 'answer' is the missing word. No options.\n"
        "- correct-the-sentence: 'text' is ONE sentence with a grammar mistake. 'answer' is the corrected sentence.\n"
        "- choose-the-word: 'text' is a sentence with a '___' blank. 'options' is 3-4 choices. 'answer' is the correct option.\n"
        "Keep it to one sentence. Reply ONLY as JSON matching the schema."
    )


def _check_prompt(ex_type: str, text: str, options: list[str] | None, user_answer: str) -> str:
    opts = f"\nOptions: {options}" if options else ""
    return (
        "You are an English grammar tutor for a Pre-Intermediate learner.\n"
        f"Exercise type: {ex_type}\nExercise: {text}{opts}\n"
        f"The learner's answer: {user_answer!r}\n\n"
        "Decide if the answer is correct. Give the correct answer, a short explanation in clear "
        "English (max 2 sentences), and one short practical tip. Reply ONLY as JSON matching the schema."
    )


async def generate_exercise() -> dict[str, Any]:
    """Generate a new exercise. Returns the full dict including 'answer'."""
    topic = pick_topic()
    ex_type = random.choice(EXERCISE_TYPES)
    data = await generate_json(_exercise_prompt(topic, ex_type), EXERCISE_SCHEMA)
    data["topic"] = topic
    data.setdefault("type", ex_type)
    data.setdefault("options", [])
    # Normalize: a "choose-the-word" without real options is just a fill-the-gap,
    # so the type label matches what the UI can render.
    if data["type"] == "choose-the-word" and len(data.get("options") or []) < 2:
        data["type"] = "fill-the-gap"
        data["options"] = []
    return data


async def check_answer(
    ex_type: str, text: str, options: list[str] | None, user_answer: str
) -> dict[str, Any]:
    """Check the learner's answer against the exercise; returns verdict + explanation."""
    return await generate_json(_check_prompt(ex_type, text, options, user_answer), CHECK_SCHEMA)
