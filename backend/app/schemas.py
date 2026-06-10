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
    context: Optional[str] = Field(default=None, max_length=300)  # domain/goal hint string
    # Recent items the learner got wrong on this topic, to personalize generation (sanitized + capped
    # server-side). Count bounded here; per-item length/whitespace handled in grammar._sanitize_mistakes.
    mistakes: list[str] = Field(default_factory=list, max_length=5)


class MatchItem(BaseModel):
    id: int
    text: str


class ExerciseOut(BaseModel):
    """One exercise. Shape varies by `type`; unused fields are omitted.

    - multiple-choice: text + options
    - build-the-sentence: tiles (shuffled words)
    - match-pairs: left + right (right shuffled)
    - tap-the-error: tokens (tappable words)
    - odd-one-out: options (one doesn't belong; tap it)
    - multiple-blanks: text (with several '___') + blankOptions (choices per blank, in order)
    - order-the-dialog: tiles (shuffled dialog lines to reorder)
    - free-text: text (typed answer, LLM-graded)

    `token` seals the answer for interactive types (graded server-side); it is None for free-text.
    The correct answer is intentionally NOT exposed in plaintext.
    """

    type: str
    topic: str
    level: str = ""  # effective CEFR served (A1..C1); lets the client score difficulty-aware
    text: str = ""
    prompt: str = ""  # source line for translation exercises (e.g. the Russian sentence)
    options: list[str] = []
    tiles: list[str] = []
    tokens: list[str] = []
    left: list[MatchItem] = []
    right: list[MatchItem] = []
    blankOptions: list[list[str]] = []  # multiple-blanks: choices per blank, left-to-right
    token: Optional[str] = None


# --- themed sets / mini-stories (Batch 2) ---
class StoryIn(BaseModel):
    """Optional steering for a mini-story. `level` locks CEFR across the whole set; `context`
    overrides the scenario's flavor. Both optional — anything omitted falls back to defaults."""

    level: Optional[str] = Field(default=None, max_length=4)  # CEFR: A1..C1
    context: Optional[str] = Field(default=None, max_length=300)


class StoryBeat(BaseModel):
    """One step of a mini-story: a line of narration plus its exercise (graded via /check)."""

    narration: str = ""
    exercise: ExerciseOut


class StoryOut(BaseModel):
    """A themed set: a curated narrative wrapping an ordered list of linked exercises."""

    id: str
    title: str
    intro: str = ""
    level: str = ""  # effective CEFR served across the set
    beats: list[StoryBeat] = []


# --- deterministic interactive check (Phase 2.5) ---
class CheckIn(BaseModel):
    """`response` shape depends on the type: chosen option / assembled sentence (str),
    tapped index (int), left-id -> right-id map (dict), or an ordered list of strings
    (multiple-blanks: picks per blank; order-the-dialog: lines in chosen order)."""

    token: str = Field(min_length=1, max_length=MAX_TOKEN)
    response: Union[str, int, dict[str, int], list[str]]


class CheckOut(BaseModel):
    correct: bool
    correct_answer: str
    score: float = 1.0  # fraction right (0..1); partial credit for multi-element types
    detail: str = ""  # e.g. "2/3" for multi-element answers; "" for single-answer types
    # Koku earned for this answer (authenticated + correct only) and the new balance.
    # 0 / None for anonymous callers — fully backward compatible.
    coins_earned: int = 0
    coins: Optional[int] = None


# --- free-text check (LLM) ---
class CheckTextIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    user_answer: str = Field(min_length=1, max_length=MAX_ANSWER)
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for the explanation


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
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for the explanation


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
    is_verified: bool = False
    is_premium: bool = False
    coins: int = 0
    freezes: int = 0


# --- economy: koku wallet ---
class WalletOut(BaseModel):
    coins: int = 0
    freezes: int = 0
    is_premium: bool = False
    # Exercises remaining today on the free tier; None = unlimited (premium). Drives the Home
    # counter — the user should SEE the limit shrinking before they hit it.
    left_today: Optional[int] = None


class SpendIn(BaseModel):
    """Spend koku (or consume an owned item). `item` is validated against the server catalog.
    qty: item count; for streak_repair it's the lost streak length (price input), hence the cap."""

    item: str = Field(min_length=1, max_length=40)
    qty: int = Field(default=1, ge=1, le=400)


class MessageOut(BaseModel):
    message: str


# --- progress sync (Phase 4): typed mirror of the client snapshot ---
class TopicStat(BaseModel):
    attempts: int = 0
    correct: int = 0
    lastSeen: str = ""  # local YYYY-MM-DD of last practice; drives spaced repetition (adaptive.ts)


class Profile(BaseModel):
    goals: list[str] = []
    focusTopics: list[str] = []
    selfLevel: str = ""  # beginner | intermediate | advanced
    dailyMinutes: int = 0
    domains: list[str] = []
    painText: str = ""


class BrokenStreak(BaseModel):
    """A noticed streak break awaiting paid repair (client-side window; see mobile store/streak.ts)."""

    streak: int = 0
    date: str = ""  # local YYYY-MM-DD when the break was noticed


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
    todayDate: str = ""
    todayCount: int = 0
    brokenStreak: Optional[BrokenStreak] = None


# --- onboarding free-text analysis (Phase: onboarding) ---
class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class AnalyzeOut(BaseModel):
    topics: list[str] = []  # subset of the canonical grammar topics
