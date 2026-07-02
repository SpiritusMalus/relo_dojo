"""Server-side miss log — cross-device personalization RAG over the learner's own errors.

The client keeps a local Review deck (mobile/store/mistakes.ts) and feeds per-topic miss sentences
back into /exercise, but that memory lives in AsyncStorage: it dies with a reinstall and never
follows the learner to a new device. This is the server twin. /check records the drill sentence of
every missed item for authenticated callers (newer exercise tokens carry `topic` + a representative
`text`; older tokens simply don't feed the log — they still grade fine), and /exercise retrieves
the freshest rows to fill the personalization hints when the client sends fewer than
MAX_MISTAKE_HINTS.

Bounded by design, like every per-user table here: one row per distinct (user, topic, text) — a
repeat miss bumps the timestamp/counter — and at most MISS_CAP rows per (user, topic), oldest
trimmed on write. `text` is server-generated exercise content, not learner-authored prose; egress
into an LLM prompt is still gated by the caller on the same 152-ФЗ consent as profile context.
Recording must never break grading: record_miss swallows (and logs) storage errors.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import MissLog, User

logger = logging.getLogger(__name__)

# Keep the newest N rows per (user, topic). 10 ≫ MAX_MISTAKE_HINTS (3), so retrieval always has
# fresh material even after dedupe against client hints, while the table stays bounded.
MISS_CAP = 10
_TEXT_MAX_LEN = 160  # storage cap; the prompt-side cap (_MISTAKE_MAX_LEN=120) trims further


def _clean(s: str | None, cap: int) -> str:
    return " ".join((s or "").split())[:cap].strip()


def merge_hints(client: list[str], server: list[str], cap: int) -> list[str]:
    """Client hints first (they carry the device's freshest session, newest-first), then server rows
    fill the remainder. Case/space-insensitive dedupe, capped. Pure."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in [*client, *server]:
        s = _clean(str(raw), _TEXT_MAX_LEN)
        if not s or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
        if len(out) >= cap:
            break
    return out


async def record_miss(db: AsyncSession, user: User | None, topic: str | None, text: str | None) -> None:
    """Record one missed item. No-op for anonymous callers and for tokens without topic/text.
    Upsert on (user, topic, text) — a repeat miss bumps missed_at/misses — then trim the (user,
    topic) bucket to MISS_CAP newest rows. Swallows storage errors: bookkeeping never breaks /check."""
    t = _clean(topic, 60)
    s = _clean(text, _TEXT_MAX_LEN)
    if user is None or not t or not s:
        return
    try:
        await db.execute(
            pg_insert(MissLog)
            .values(user_id=user.id, topic=t, text=s)
            .on_conflict_do_update(
                constraint="uq_miss_log_user_topic_text",
                set_={"misses": MissLog.misses + 1, "missed_at": func.now()},
            )
        )
        # Trim the bucket to the newest MISS_CAP rows (the whole point: bounded, fresh memory).
        keep = (
            select(MissLog.id)
            .where(MissLog.user_id == user.id, MissLog.topic == t)
            .order_by(MissLog.missed_at.desc())
            .limit(MISS_CAP)
        )
        await db.execute(
            delete(MissLog).where(
                MissLog.user_id == user.id, MissLog.topic == t, MissLog.id.not_in(keep)
            )
        )
        await db.commit()
    except Exception:  # never fail grading on bookkeeping
        logger.exception("miss_log: record failed — skipping.")
        await db.rollback()


async def recent_misses(db: AsyncSession, user: User, topic: str, limit: int) -> list[str]:
    """The learner's freshest missed drill sentences for `topic`, newest first."""
    rows = await db.execute(
        select(MissLog.text)
        .where(MissLog.user_id == user.id, MissLog.topic == topic)
        .order_by(MissLog.missed_at.desc())
        .limit(limit)
    )
    return [r[0] for r in rows]
