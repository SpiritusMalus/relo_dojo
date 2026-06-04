"""Pydantic request/response schemas — validation on the boundary (handoff standard).

Input length limits keep a single request from exhausting the model / RAM and reject junk
with an automatic 422 before it ever reaches Ollama.
"""

from __future__ import annotations

from typing import Optional, Union

from pydantic import BaseModel, EmailStr, Field

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
class ExerciseIn(BaseModel):
    """Optional difficulty steering from the client (adaptive difficulty). All fields optional;
    anything invalid/omitted falls back to the backend's weighted defaults."""

    topic: Optional[str] = Field(default=None, max_length=60)
    level: Optional[str] = Field(default=None, max_length=4)  # CEFR: A1..C1
    type: Optional[str] = Field(default=None, max_length=40)
    context: Optional[str] = Field(default=None, max_length=40)  # domain hint, e.g. "backend"


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


# --- accounts (Phase 4) ---
MIN_PASSWORD = 8
MAX_PASSWORD = 128


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=MAX_PASSWORD)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: EmailStr


# --- progress sync (Phase 4): typed mirror of the client snapshot ---
class TopicStat(BaseModel):
    attempts: int = 0
    correct: int = 0


class Profile(BaseModel):
    goal: str = ""
    focusTopics: list[str] = []
    selfLevel: str = ""  # beginner | intermediate | advanced
    dailyMinutes: int = 0
    domain: str = ""
    painText: str = ""


class ProgressData(BaseModel):
    xp: int = 0
    dailyStreak: int = 0
    lastActiveDate: str = ""
    currentCorrectRun: int = 0
    bestCorrectRun: int = 0
    topics: dict[str, TopicStat] = {}
    achievements: list[str] = []
    skill: dict[str, float] = {}  # per-topic adaptive level (0..5)
    onboarded: bool = False
    profile: Optional[Profile] = None


# --- onboarding free-text analysis (Phase: onboarding) ---
class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class AnalyzeOut(BaseModel):
    topics: list[str] = []  # subset of the canonical grammar topics
