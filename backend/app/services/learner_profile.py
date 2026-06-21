"""Server-side learner profile (Praktika adoption Stage 1).

The profile is the persistent memory layer: goal, sphere, interests, tone, weak-spot summary,
goal history. It is retrieved at feedback time (/explain, /check-answer) so the tutor reacts to
the CURRENT mistake with the learner's history in mind — the pattern Praktika credits for its
retention gains. Pure helpers here; endpoint wiring lives in routers/profile.py and main.py.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import LearnerProfile, User
from ..schemas import GoalEntry, LearnerProfileData

# Keep the trail bounded (oldest entries fall off). Matches the schema cap
# (schemas.LearnerProfileData.goalHistory max_length=50) so the apply_goal trim and a direct
# PUT /profile agree on one bound — neither can persist more than the other accepts.
MAX_GOAL_HISTORY = 50


async def get_data(user: User | None, db: AsyncSession) -> LearnerProfileData | None:
    """The caller's profile, or None when anonymous / never saved."""
    if user is None:
        return None
    row = await db.get(LearnerProfile, user.id)
    if row is None:
        return None
    return LearnerProfileData(**row.data)


async def upsert(user: User, db: AsyncSession, data: LearnerProfileData) -> LearnerProfileData:
    """Replace the caller's profile snapshot (validated shape only)."""
    row = await db.get(LearnerProfile, user.id)
    payload = data.model_dump()
    if row is None:
        db.add(LearnerProfile(user_id=user.id, data=payload))
    else:
        row.data = payload
    await db.commit()
    return data


def apply_goal(
    data: LearnerProfileData, text: str, topics: list[str], today: str | None = None
) -> LearnerProfileData:
    """Pure: set a new current goal + append it to the history (bounded). Testable offline."""
    entry = GoalEntry(text=text, date=today or date.today().isoformat(), topics=topics)
    data.goal = text
    data.goalTopics = topics
    data.goalHistory = (data.goalHistory + [entry])[-MAX_GOAL_HISTORY:]
    return data


async def save_goal(user: User, db: AsyncSession, text: str, topics: list[str]) -> None:
    """Persist a free-text goal into the caller's profile (creates the profile if missing)."""
    data = await get_data(user, db) or LearnerProfileData()
    await upsert(user, db, apply_goal(data, text, topics))


def apply_review(data: LearnerProfileData, topics: list[str], today: str | None = None) -> LearnerProfileData:
    """Pure: fold a text review's findings into the weak-spot summary (Stage 3 feeds Stage 1's
    memory until the Stage 2 Progress Agent owns this field). Empty findings clear nothing."""
    if topics:
        day = today or date.today().isoformat()
        data.weakSpots = f"Text review {day}: issues with {', '.join(dict.fromkeys(topics))}"
    return data


async def save_review(user: User, db: AsyncSession, topics: list[str]) -> None:
    """Persist text-review findings into the caller's weak-spot summary."""
    data = await get_data(user, db) or LearnerProfileData()
    await upsert(user, db, apply_review(data, topics))
