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
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for LLM-generated task instructions (transform-the-sentence)


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
    - transform-the-sentence: prompt (source sentence) + instruction (the transform) + tiles
    - free-text: text (typed answer, LLM-graded)

    `token` seals the answer for interactive types (graded server-side); it is None for free-text.
    The correct answer is intentionally NOT exposed in plaintext.
    """

    type: str
    topic: str
    level: str = ""  # effective CEFR served (A1..C1); lets the client score difficulty-aware
    text: str = ""
    prompt: str = ""  # source line for translation exercises (e.g. the Russian sentence)
    instruction: str = ""  # transform-the-sentence: the grammar transform to apply to `prompt`
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
    id: Optional[str] = Field(default=None, max_length=40)  # specific arc; omitted → random/featured
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for LLM-generated task instructions (transform beats)


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


# --- story arcs / content unlocks (engagement v2 Phase 3) ---
class StoryArcOut(BaseModel):
    id: str
    title: str
    intro: str = ""
    locked: bool = False  # premium arc not yet owned
    owned: bool = True  # free arcs and bought ones
    price: int = 0  # koku to unlock (0 for free)
    featured: bool = False  # today's rotating pick


class StoryCatalogOut(BaseModel):
    featured_id: str
    arcs: list[StoryArcOut] = Field(default_factory=list)


class ContentIn(BaseModel):
    id: str = Field(min_length=1, max_length=40)


class ContentBuyOut(BaseModel):
    owned: list[str] = Field(default_factory=list)
    coins: int = 0


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
    # Per-element marks in display order (match rows, blanks, dialog lines) so the client can point
    # at the exact rows that were wrong — "2/4" alone sends the learner hunting. [] = single-answer.
    per_item: list[bool] = []
    # Koku earned for this answer (authenticated + correct only) and the new balance.
    # 0 / None for anonymous callers — fully backward compatible.
    coins_earned: int = 0
    coins: Optional[int] = None
    # Portion of coins_earned that was the once-per-day first-win bonus (0 otherwise) — lets the
    # client celebrate the daily anchor distinctly.
    first_win_bonus: int = 0
    # Portion of coins_earned from the consecutive-correct combo (0 otherwise).
    combo_bonus: int = 0


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
    # ISO-8601 paid-subscription expiry (null = no paid sub; is_premium may still be true if comped).
    premium_until: Optional[str] = None
    coins: int = 0
    freezes: int = 0
    # Cosmetics (engagement v2): everything the user can equip + what's equipped per slot.
    cosmetics: list[str] = Field(default_factory=list)
    equipped: dict[str, str] = Field(default_factory=dict)
    # Feature capability map (services/access.py): the client reads booleans, never re-derives gating.
    access: dict[str, bool] = Field(default_factory=dict)
    # 152-ФЗ cross-border consent audit: the accepted version ("" = not yet) + ISO-8601 timestamp.
    pd_consent_version: str = ""
    pd_consent_at: Optional[str] = None


class ConsentIn(BaseModel):
    """Record acceptance of the standalone PD/cross-border consent (POST /auth/consent)."""

    version: str = Field(min_length=1, max_length=20)


# --- account data export (store-compliance: the "export your data" right) ---
class ExportAccount(BaseModel):
    """The account row, minus secrets (no password hash, ever). Mirrors what the user owns."""

    id: str
    email: EmailStr
    is_verified: bool = False
    is_premium: bool = False
    premium_until: Optional[str] = None  # ISO-8601 paid-subscription expiry (null = none)
    coins: int = 0
    freezes: int = 0
    cosmetics: list[str] = Field(default_factory=list)
    equipped: dict[str, str] = Field(default_factory=dict)
    unlocks: list[str] = Field(default_factory=list)
    created_at: Optional[str] = None  # ISO-8601 account creation time
    # 152-ФЗ cross-border consent audit: the version the user accepted + when (provable acceptance).
    pd_consent_version: str = ""
    pd_consent_at: Optional[str] = None  # ISO-8601 acceptance time (null = not yet accepted)


class ExportEvent(BaseModel):
    """One analytics row attributed to the caller (server-stamped time)."""

    name: str
    props: dict = Field(default_factory=dict)
    ts: Optional[str] = None  # ISO-8601 server receipt time


class ExportPayment(BaseModel):
    """One premium purchase attributed to the caller. The receipt itself survives account deletion
    (anonymized), but the live owner can export their own purchase history while the account exists."""

    provider: str  # e.g. "yookassa"
    plan: str  # plan id granted, e.g. "black_belt_12m"
    days: int  # premium days granted by this payment
    created_at: Optional[str] = None  # ISO-8601 receipt time


class AccountExport(BaseModel):
    """Everything we hold about the caller, returned by GET /auth/export. JSON the user can keep."""

    account: ExportAccount
    progress: dict = Field(default_factory=dict)  # progress.data snapshot ({} if never synced)
    learner_profile: dict = Field(default_factory=dict)  # learner_profile.data ({} if none)
    events: list[ExportEvent] = Field(default_factory=list)
    payments: list[ExportPayment] = Field(default_factory=list)  # purchase history ([] if none)


# --- cosmetics (engagement v2) ---
class CosmeticsOut(BaseModel):
    """Owned ids (incl. implicit starters) + equipped id per slot."""

    owned: list[str] = Field(default_factory=list)
    equipped: dict[str, str] = Field(default_factory=dict)


class CosmeticIn(BaseModel):
    id: str = Field(min_length=1, max_length=40)


# --- daily contracts (engagement v2, Phase 2) ---
class ContractOut(BaseModel):
    id: str
    metric: str
    target: int
    reward: int
    progress: int
    done: bool
    claimed: bool


class ContractsOut(BaseModel):
    day: str
    contracts: list[ContractOut] = Field(default_factory=list)
    coins: int = 0


class ContractClaimIn(BaseModel):
    id: str = Field(min_length=1, max_length=40)


class ContractClaimOut(BaseModel):
    claimed: bool
    reward: int = 0
    coins: int = 0


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
    sphere: str = ""  # top-level field of work/interest (was silently dropped on sync before)
    domains: list[str] = []
    painText: str = ""
    tone: str = ""  # feedback tone preference (soft | balanced | strict); "" = default
    # Client-owned gamification state mirrored through sync (shapes live in the mobile stores):
    # planWeights/planNote/planDate/planGoal/planBaseline/planBonusPaid (quest scroll),
    # wins (Progress Agent line), remindHour, diary (weekly recap). Kept as loose fields so the
    # server never silently drops them (the Profile.sphere lesson).
    wins: str = ""
    planWeights: Optional[dict] = None
    planNote: str = ""
    planDate: str = ""
    planGoal: str = ""
    planBaseline: Optional[dict] = None
    planBonusPaid: str = ""
    remindHour: Optional[int] = None
    diary: Optional[dict] = None


class BrokenStreak(BaseModel):
    """A noticed streak break awaiting paid repair (client-side window; see mobile store/streak.ts)."""

    streak: int = 0
    date: str = ""  # local YYYY-MM-DD when the break was noticed


class Steering(BaseModel):
    """Learner-set overrides on the adaptive model (client store/adaptive). Synced so the steering
    (pinned focus topic, muted topics, per-format prefs, difficulty bias) survives device changes.
    `formatPrefs` keys are exercise types plus the "pronunciation" modality."""

    pinnedFocusTopic: Optional[str] = None
    mutedTopics: list[str] = []
    formatPrefs: dict[str, bool] = {}
    difficultyBias: float = 0.0


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
    boostUntil: str = ""  # ISO timestamp while the x2-XP "kensei" boost is active ("" = none)
    # Belt exam (client mechanic; synced so the worn belt survives device changes).
    beltEarned: Optional[int] = None
    lastExamDate: str = ""
    steering: Steering = Field(default_factory=Steering)  # learner-set adaptive overrides (synced)


# --- scroll rewards (variable reinforcement) ---
class ScrollOut(BaseModel):
    """One opened scroll: what dropped + the post-credit balances."""

    kind: str  # "koku" | "omamori" | "kensei"
    amount: int
    coins: int
    freezes: int


class AdRewardOut(BaseModel):
    """Result of a completed rewarded ad: koku granted + new balance + grants left today."""

    amount: int
    coins: int
    left_today: int


# --- onboarding free-text analysis (Phase: onboarding) ---
class AnalyzeIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class AnalyzeOut(BaseModel):
    topics: list[str] = []  # subset of the canonical grammar topics
    saved: bool = False  # true when the goal was persisted into the caller's learner profile


# --- "Review my text" (Praktika adoption Stage 3) ---
class ReviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for notes


class ReviewIssue(BaseModel):
    quote: str  # exact fragment from the learner's text
    better: str  # corrected fragment, natural English
    topic: str  # canonical grammar topic
    note: str = ""  # one short reason, in the learner's language


class ReviewOut(BaseModel):
    summary: str = ""
    issues: list[ReviewIssue] = []
    topics: list[str] = []  # distinct topics found (client convenience; also fed to the profile)


# --- writing assessment (Level Test productive-skill section) ---
class WritingAssessIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    prompt: Optional[str] = Field(default=None, max_length=300)  # the task the learner answered
    lang: Optional[str] = Field(default=None, max_length=8)  # learner UI language for the note


class WritingAssessOut(BaseModel):
    cefr: str  # A1..C1
    score: float  # 0..5 (midpoint of the band) — folded into the Level Test overall
    note: str = ""


# --- learner profile (Praktika adoption Stage 1: server-side memory layer) ---
TONES = ("soft", "balanced", "strict")


class GoalEntry(BaseModel):
    """One entry in the goal history: what the learner said, when, and how it was classified."""

    text: str = ""
    date: str = ""  # ISO date the goal was set
    topics: list[str] = []  # canonical grammar topics extracted from the text


class PlanData(BaseModel):
    """The Planner's output (Stage 2): per-topic urgency multipliers the client's adaptive
    engine folds into topic selection, plus a one-line human focus note."""

    topicWeights: dict[str, float] = {}
    note: str = Field(default="", max_length=300)
    date: str = ""  # ISO date the plan was made (drives the weekly refresh trigger)
    goal: str = Field(default="", max_length=MAX_TEXT)  # goal the plan was built for


class LearnerProfileData(BaseModel):
    """The shared learner memory all feedback and agents read.

    Stored as one JSONB row per user (db.models.LearnerProfile). `goal` is the CURRENT free-text
    goal; `goalHistory` keeps the trail. `weakSpots` (internal, English) and `wins` (learner-facing,
    UI language) are written by the Stage 2 Progress Agent; `plan` by the Stage 2 Planner."""

    goal: str = Field(default="", max_length=MAX_TEXT)
    goalTopics: list[str] = Field(default_factory=list, max_length=20)
    sphere: str = Field(default="", max_length=120)
    domains: list[str] = Field(default_factory=list, max_length=20)
    interests: list[str] = Field(default_factory=list, max_length=20)
    tone: str = "balanced"  # soft | balanced | strict (anything else falls back to balanced)
    weakSpots: str = Field(default="", max_length=500)
    wins: str = Field(default="", max_length=300)
    plan: Optional[PlanData] = None
    goalHistory: list[GoalEntry] = Field(default_factory=list, max_length=50)

    def model_post_init(self, __context: object) -> None:
        if self.tone not in TONES:
            self.tone = "balanced"


# --- Stage 2 agents: session summary in, profile delta / plan out ---
class SessionAnswer(BaseModel):
    topic: str = Field(max_length=60)
    correct: bool
    level: str = Field(default="", max_length=4)  # CEFR the item was served at


class SessionIn(BaseModel):
    answers: list[SessionAnswer] = Field(min_length=1, max_length=100)
    lang: Optional[str] = Field(default=None, max_length=8)  # UI language for `wins`


class ProgressAgentOut(BaseModel):
    weakSpots: str = ""
    wins: str = ""


class TopicStatsIn(BaseModel):
    attempts: int = Field(ge=0, le=100000)
    correct: int = Field(ge=0, le=100000)
    skill: float = Field(ge=0, le=5)  # adaptive level 0..5


class PlanIn(BaseModel):
    stats: dict[str, TopicStatsIn] = Field(default_factory=dict)
    lang: Optional[str] = Field(default=None, max_length=8)  # UI language for the note


# --- analytics events (north-star Day-7 retention instrumentation) ---
MAX_EVENT_NAME = 64
MAX_ANON_ID = 64
MAX_EVENTS_PER_BATCH = 50


class EventIn(BaseModel):
    """One tracked action. `name` is a short event key (e.g. "session_complete"); `props` is a
    small free-form bag of context. `ts` is the client timestamp (epoch ms, advisory only — the
    server stamps its own canonical time). Tight caps keep a batch cheap and reject junk at 422."""

    name: str = Field(min_length=1, max_length=MAX_EVENT_NAME)
    props: dict[str, Union[str, int, float, bool, None]] = Field(default_factory=dict)
    ts: Optional[int] = Field(default=None, ge=0)  # client epoch ms (advisory)


class EventBatchIn(BaseModel):
    """Events are sent in batches (the client buffers and flushes) to save round-trips/battery.
    `anon_id` attributes pre-login activity; once authenticated the server uses the user id."""

    anon_id: Optional[str] = Field(default=None, max_length=MAX_ANON_ID)
    events: list[EventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_BATCH)


class EventAck(BaseModel):
    accepted: int


# --- web-checkout billing (premium "Black Belt": YooKassa) ---
class BillingPlanOut(BaseModel):
    id: str
    days: int
    price_rub: int
    label_en: str
    label_ru: str


class PlansOut(BaseModel):
    """The plan catalog for the web checkout to render (RUB prices)."""

    plans: list[BillingPlanOut] = Field(default_factory=list)


class CheckoutIn(BaseModel):
    """Start a purchase: which plan, over which rail. The buyer is the authenticated caller — never
    taken from the request body — so a checkout can only ever top up your OWN account."""

    plan: str = Field(min_length=1, max_length=40)
    method: str = Field(pattern="^yookassa$")


class CheckoutOut(BaseModel):
    """Where to send the buyer next — the provider's hosted checkout / invoice page."""

    url: str


# --- voice (pronunciation: read-aloud transcription + Gemini Live token) -----
# The precise byte/duration guard is enforced in the handler (413); this static cap only bounds the
# request body so an oversized payload is rejected early. ~4M base64 chars ≈ 3 MB of audio.
_MAX_AUDIO_B64 = 4_000_000


class TranscribeIn(BaseModel):
    """Read-aloud upload: base64 audio + its container mime. The pass/fail compare is client-side
    (services/voice gradeReadAloud) — the server only returns a faithful verbatim transcript."""

    audio: str = Field(min_length=1, max_length=_MAX_AUDIO_B64)
    mime: str = Field(min_length=1, max_length=60)
    lang: Optional[str] = Field(default=None, max_length=8)


class TranscribeOut(BaseModel):
    transcript: str


class LiveTokenOut(BaseModel):
    """A short-lived ephemeral credential for a client↔Google Gemini Live session — so the real
    GEMINI_API_KEY never ships in the app bundle. `model` is resolved server-side from the live list."""

    token: str
    expiresAt: str
    model: str
