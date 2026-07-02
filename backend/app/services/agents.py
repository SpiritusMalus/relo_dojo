"""Stage 2 agents (Praktika adoption): Progress Agent + Planner.

Mirrors Praktika's multi-agent split on our stack, as plain LLM jobs over the shared
learner profile (no extra services):

- **Progress Agent** — runs after a session: session answers + current memory → an updated
  `weakSpots` summary (internal, English — fed into feedback prompts) and a learner-facing
  `wins` line (UI language — shown on the Progress tab). Cheap-model work.
- **Planner** — runs on triggers (client-evaluated: new goal / 3-day lapse / error spike /
  plan older than a week): profile + per-topic stats → per-topic urgency weights the client's
  adaptive engine folds into topic selection, plus a one-line focus note. Mid-model work.

Both go through services.llm, so they run on whatever LLM_PROVIDER is active (Ollama in dev).
Output is sanitized here — weights clamped, unknown topics dropped — the model never gets to
steer the engine outside safe bounds.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ..core.config import CHECK_TEMPERATURE
from ..schemas import LearnerProfileData, PlanData, SessionAnswer, TopicStatsIn
from .grammar import GUARDRAIL, TOPICS, _explain_lang
from .llm import generate_json

_TOPIC_NAMES = [t for t, _ in TOPICS]

# Planner weights are multipliers on the client's topicWeight(); keep them in a sane band so a
# bad model output can never zero-out or monopolize a topic.
WEIGHT_MIN = 0.5
WEIGHT_MAX = 2.0

PROGRESS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"weak_spots": {"type": "string"}, "wins": {"type": "string"}},
    "required": ["weak_spots", "wins"],
}

PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "topic_weights": {
            "type": "object",
            "properties": {t: {"type": "number"} for t in _TOPIC_NAMES},
        },
        "note": {"type": "string"},
    },
    "required": ["topic_weights", "note"],
}


# --- pure prompt builders / sanitizers (unit-tested offline) -------------------
def session_digest(answers: list[SessionAnswer]) -> str:
    """Compact per-topic right/total lines the model can actually read."""
    agg: dict[str, list[int]] = {}
    for a in answers:
        got = agg.setdefault(a.topic, [0, 0])
        got[1] += 1
        got[0] += int(a.correct)
    return "; ".join(f"{t}: {r}/{n}" for t, (r, n) in sorted(agg.items()))


def progress_prompt(profile: LearnerProfileData, answers: list[SessionAnswer], lang: str | None) -> str:
    note_lang = _explain_lang(lang)
    goal = f"Learner's goal: {profile.goal}\n" if profile.goal else ""
    prev = f"Current weak-spot memory: {profile.weakSpots}\n" if profile.weakSpots else ""
    return (
        "You are the Student Progress agent of an English-learning app. After each practice "
        "session you update the learner's memory.\n"
        + GUARDRAIL
        + goal
        + prev
        + f"This session's results (right/total per topic): {session_digest(answers)}\n\n"
        "Write 'weak_spots': an updated memory summary in English, max 2 sentences, naming the "
        "specific error patterns to keep working on (merge with the current memory; drop what was "
        "clearly overcome). "
        f"Write 'wins' in {note_lang}: ONE encouraging sentence about what visibly improved or got "
        "mastered this session — frame slips as progress in the making, never as failure. "
        "Reply ONLY as JSON matching the schema."
    )


def stats_digest(stats: dict[str, TopicStatsIn]) -> str:
    lines = []
    for t in _TOPIC_NAMES:
        s = stats.get(t)
        if s and s.attempts:
            lines.append(f"{t}: {s.correct}/{s.attempts}, level {s.skill:.1f}/5")
    return "; ".join(lines) or "no practice data yet"


def plan_prompt(profile: LearnerProfileData, stats: dict[str, TopicStatsIn], lang: str | None) -> str:
    note_lang = _explain_lang(lang)
    goal = f"Learner's goal: {profile.goal}\n" if profile.goal else ""
    weak = f"Weak-spot memory: {profile.weakSpots}\n" if profile.weakSpots else ""
    sphere = f"Learner's field: {profile.sphere}\n" if profile.sphere else ""
    return (
        "You are the Learning Planner agent of an English-learning app. You decide what the "
        "learner should practice next week.\n"
        + GUARDRAIL
        + goal
        + sphere
        + weak
        + f"Per-topic stats (right/attempts, level 0-5): {stats_digest(stats)}\n\n"
        f"For each topic give a practice-urgency weight between {WEIGHT_MIN} and {WEIGHT_MAX} "
        "(1.0 = neutral; raise topics that serve the goal or show weakness; lower mastered ones "
        "but keep light review — do not zero anything). "
        f"Write 'note' in {note_lang}: ONE sentence telling the learner what this week's focus is "
        "and why it serves their goal. Reply ONLY as JSON matching the schema."
    )


def sanitize_weights(raw: Any) -> dict[str, float]:
    """Known topics only, clamped to [WEIGHT_MIN, WEIGHT_MAX]; junk → dropped (defaults to 1)."""
    out: dict[str, float] = {}
    if not isinstance(raw, dict):
        return out
    for t in _TOPIC_NAMES:
        v = raw.get(t)
        if isinstance(v, (int, float)):
            out[t] = round(min(WEIGHT_MAX, max(WEIGHT_MIN, float(v))), 2)
    return out


# --- agent runs (LLM calls; applied to the profile by the router) ---------------
async def run_progress_agent(
    profile: LearnerProfileData, answers: list[SessionAnswer], lang: str | None
) -> LearnerProfileData:
    """Session → profile delta. Mutates and returns `profile` (caller persists)."""
    data = await generate_json(
        progress_prompt(profile, answers, lang), PROGRESS_SCHEMA, temperature=CHECK_TEMPERATURE
    )
    weak = " ".join(str(data.get("weak_spots") or "").split())[:500].strip()
    wins = " ".join(str(data.get("wins") or "").split())[:300].strip()
    if weak:
        profile.weakSpots = weak
    if wins:
        profile.wins = wins
    return profile


async def run_planner(
    profile: LearnerProfileData,
    stats: dict[str, TopicStatsIn],
    lang: str | None,
    today: str | None = None,
) -> LearnerProfileData:
    """Profile + stats → plan. Mutates and returns `profile` (caller persists)."""
    # Smart tier: the Planner is the "mid-model work" of the Stage-2 split — it runs on rare
    # triggers (weekly / goal change), so a stronger model here is quality without a cost story.
    data = await generate_json(
        plan_prompt(profile, stats, lang), PLAN_SCHEMA, temperature=CHECK_TEMPERATURE, tier="smart"
    )
    profile.plan = PlanData(
        topicWeights=sanitize_weights(data.get("topic_weights")),
        note=" ".join(str(data.get("note") or "").split())[:300].strip(),
        date=today or date.today().isoformat(),
        goal=profile.goal,
    )
    return profile
