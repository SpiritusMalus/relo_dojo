"""Pydantic request/response schemas — validation on the boundary (handoff standard).

Input length limits keep a single request from exhausting the model / RAM and reject junk
with an automatic 422 before it ever reaches Ollama.
"""

from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel, Field

MAX_TEXT = 2000  # chars for free-form fields sent to the model
MAX_ANSWER = 1000
MAX_OPTIONS = 10
MAX_TOKEN = 4000  # sealed exercise token


# --- free chat (Phase 1) ---
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_TEXT)


class ChatOut(BaseModel):
    reply: str


# --- learning core (Phase 2 / 2.5) ---
class MatchItem(BaseModel):
    id: int
    text: str


class ExerciseOut(BaseModel):
    """One exercise. Shape varies by `type`; unused fields are omitted.

    - multiple-choice: text + options
    - build-the-sentence: tiles (shuffled words)
    - match-pairs: left + right (right shuffled)
    - tap-the-error: tokens (tappable words)
    - free-text: text (typed answer, LLM-graded)

    `token` seals the answer for interactive types (graded server-side); it is None for free-text.
    The correct answer is intentionally NOT exposed in plaintext.
    """

    type: str
    topic: str
    text: str = ""
    prompt: str = ""  # source line for translation exercises (e.g. the Russian sentence)
    options: list[str] = []
    tiles: list[str] = []
    tokens: list[str] = []
    left: list[MatchItem] = []
    right: list[MatchItem] = []
    token: Optional[str] = None


# --- deterministic interactive check (Phase 2.5) ---
class CheckIn(BaseModel):
    """`response` shape depends on the type: chosen option / assembled sentence (str),
    tapped index (int), or left-id -> right-id map (dict)."""

    token: str = Field(min_length=1, max_length=MAX_TOKEN)
    response: Union[str, int, dict[str, int]]


class CheckOut(BaseModel):
    correct: bool
    correct_answer: str


# --- free-text check (LLM) ---
class CheckTextIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    user_answer: str = Field(min_length=1, max_length=MAX_ANSWER)


class CheckTextOut(BaseModel):
    correct: bool
    correct_answer: str
    explanation: str
    tip: str


# --- on-demand explanation (LLM) ---
class ExplainIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    correct_answer: str = Field(min_length=1, max_length=MAX_ANSWER)
    user_response: str = Field(default="", max_length=MAX_ANSWER)


class ExplainOut(BaseModel):
    explanation: str
    tip: str
