"""Lifecycle re-engagement emails — the Day-2 / Day-6 "come back to the mat" nudges.

Why this exists: Day-7 retention is the north star, and D7 is won by pulling a learner back on the
days *between* sign-up and day 7. We have no device push yet (it needs a dev build), but we already
have an SMTP transport (the activation email). So this is the cheapest retention lever available:
a daily batch job mails inactive learners a short Sensei-voice nudge.

Design mirrors the rest of the backend:
- The DECISION is a pure function (`due_kind`) — unit-tested without a DB, like `compute_retention`.
- "Inactive since when" = the learner's last analytics event (`Event.ts`), falling back to
  `created_at` (registered but never did anything → still nudgeable).
- Idempotency is an explicit guard table (`SentEmail`), the same pattern as `AwardedToken` /
  `ClaimedContract`: each (user, kind) is sent at most once, claimed BEFORE the send so a retried or
  concurrent run can't double-mail.

The orchestration entrypoint is `scripts/send_return_emails.py` (run daily by cron). OFF by default
via `settings.RETURN_EMAILS_ENABLED`.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import AbstractSet, NamedTuple, Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..core.config import settings
from ..db.models import Event, SentEmail, User

# Stable slugs (also the SentEmail.kind values). Don't rename — they're the idempotency key.
RETURN_DAY2 = "return_day2"
RETURN_DAY6 = "return_day6"
RETURN_KINDS = (RETURN_DAY2, RETURN_DAY6)


class Windows(NamedTuple):
    """Inactivity windows in whole days, (after, until) inclusive, per nudge kind."""

    day2: tuple[int, int]
    day6: tuple[int, int]


def windows_from_settings(s=settings) -> Windows:
    return Windows(
        day2=(s.RETURN_DAY2_AFTER_DAYS, s.RETURN_DAY2_UNTIL_DAYS),
        day6=(s.RETURN_DAY6_AFTER_DAYS, s.RETURN_DAY6_UNTIL_DAYS),
    )


def days_inactive(now: datetime, last_active: datetime) -> int:
    """Whole days between last activity and now (floored, never negative).

    Both args are timezone-aware (Event.ts / User.created_at are tz columns; pass a tz-aware now).
    A naive `last_active` is assumed UTC so a stray naive value can't blow up the batch."""
    if last_active.tzinfo is None:
        last_active = last_active.replace(tzinfo=timezone.utc)
    delta = now - last_active
    return max(0, delta.days)


def due_kind(
    days: int, already_sent: AbstractSet[str], windows: Windows
) -> Optional[str]:
    """Which return-email (if any) a learner is due, given days-inactive + what they've been sent.

    Windows are non-overlapping, so at most one matches a given `days`. The later milestone is
    checked first so a learner who is already 6+ days gone (e.g. the feature shipped after they
    lapsed) gets the day-6 nudge rather than a stale day-2 one. Each kind fires once — the upper
    bound means the long-churned (past day6 `until`) get nothing, which keeps a first deploy from
    blasting every dormant account."""
    lo6, hi6 = windows.day6
    if RETURN_DAY6 not in already_sent and lo6 <= days <= hi6:
        return RETURN_DAY6
    lo2, hi2 = windows.day2
    if RETURN_DAY2 not in already_sent and lo2 <= days <= hi2:
        return RETURN_DAY2
    return None


# ── email copy ────────────────────────────────────────────────────────────────
def _html(heading: str, body: str, cta_url: str, cta_label: str) -> str:
    return f"""\
<div style="font-family:system-ui,Arial,sans-serif;max-width:480px">
  <h2 style="margin:0 0 12px">{heading}</h2>
  <p style="color:#333">{body}</p>
  <p><a href="{cta_url}"
        style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
               padding:12px 20px;border-radius:10px;font-weight:600">{cta_label}</a></p>
  <p style="color:#999;font-size:12px;margin-top:18px">
     You're receiving this because you created a Relo Dojo account. We only nudge you a couple of
     times — then we'll leave your inbox alone.</p>
</div>"""


def build_return_email(kind: str, cta_url: str) -> tuple[str, str, str]:
    """(subject, plain_text, html) for a return-email kind. Warm, short, honest — no fake claims."""
    if kind == RETURN_DAY2:
        subject = "Your mat is still warm 🥋"
        lead = (
            "You stepped into the dojo a couple of days ago — nice work taking the first step. "
            "Your next five-minute round is ready whenever you are."
        )
        cta_label = "Train 5 minutes"
    elif kind == RETURN_DAY6:
        subject = "Your sensei is keeping your spot 🥋"
        lead = (
            "It's been a few days since your last session. Your belt journey is paused, not lost — "
            "one short round brings it right back. Five minutes is all it takes today."
        )
        cta_label = "Pick up where you left off"
    else:  # pragma: no cover — callers only pass a RETURN_KINDS value
        raise ValueError(f"unknown return-email kind: {kind}")
    text = f"{lead}\n\n{cta_label}: {cta_url}\n\nSee you on the mat,\nYour Sensei"
    return subject, text, _html("Relo Dojo", lead, cta_url, cta_label)


def cta_url(s=settings) -> str:
    """The link to drop into the email — explicit override, else the app base URL."""
    return (s.RETURN_EMAIL_CTA_URL or s.APP_BASE_URL or "").rstrip("/")


# ── data access (thin; real-DB-verified via the script, not the fake-DB unit tests) ──
async def fetch_last_active(db) -> dict[uuid.UUID, datetime]:  # pragma: no cover
    """Map user_id -> most recent event timestamp (their last sign of life)."""
    rows = await db.execute(
        select(Event.user_id, func.max(Event.ts))
        .where(Event.user_id.is_not(None))
        .group_by(Event.user_id)
    )
    return {uid: ts for uid, ts in rows.all()}


async def fetch_sent(db) -> dict[uuid.UUID, set[str]]:  # pragma: no cover
    """Map user_id -> set of return-email kinds already sent."""
    rows = await db.execute(select(SentEmail.user_id, SentEmail.kind))
    out: dict[uuid.UUID, set[str]] = defaultdict(set)
    for uid, kind in rows.all():
        out[uid].add(kind)
    return out


async def select_due_recipients(
    db, now: datetime, windows: Optional[Windows] = None
) -> list[tuple[User, str]]:  # pragma: no cover — exercised via the script on a real DB
    """Verified learners due a return email, paired with the kind to send."""
    windows = windows or windows_from_settings()
    last_active = await fetch_last_active(db)
    sent = await fetch_sent(db)
    users = (await db.execute(select(User).where(User.is_verified.is_(True)))).scalars().all()
    out: list[tuple[User, str]] = []
    for u in users:
        anchor = last_active.get(u.id) or u.created_at
        kind = due_kind(days_inactive(now, anchor), sent.get(u.id, frozenset()), windows)
        if kind is not None:
            out.append((u, kind))
    return out


async def claim_send(db, user_id: uuid.UUID, kind: str) -> bool:  # pragma: no cover — real DB
    """Atomically claim a (user, kind) send. Returns True if THIS call won the claim (caller should
    then send), False if it was already claimed. INSERT ... ON CONFLICT DO NOTHING, so concurrent or
    retried runs never double-mail. The caller commits."""
    res = await db.execute(
        pg_insert(SentEmail).values(user_id=user_id, kind=kind).on_conflict_do_nothing(
            index_elements=["user_id", "kind"]
        )
    )
    return res.rowcount > 0
