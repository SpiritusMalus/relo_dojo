"""Analytics service — the instrumentation behind the north-star metric (Day-7 retention).

Two responsibilities, both kept as pure helpers so they unit-test without a database:
- `subject_key` / `build_event_rows`: turn an authenticated-or-anonymous batch into Event rows.
- `compute_retention`: given (subject, day) first-seen and return-day data, report N-day retention.

The router (routers/events.py) is the only thin DB layer; everything decidable lives here.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from ..db.models import Event

# Event names are short, lowercase, dot/underscore-segmented keys (e.g. "session.complete").
# Anything else is normalized or rejected so the analytics namespace stays clean and queryable.
_NAME_RE = re.compile(r"[^a-z0-9._]+")
MAX_NAME_LEN = 64
MAX_PROPS_KEYS = 20
MAX_PROP_STR = 200


def normalize_name(name: str) -> str:
    """Lowercase, collapse illegal chars to '_', trim. Returns '' if nothing usable remains."""
    cleaned = _NAME_RE.sub("_", name.strip().lower()).strip("_")
    return cleaned[:MAX_NAME_LEN]


def sanitize_props(props: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Bound the prop bag: cap key count, drop non-scalar values, truncate long strings."""
    if not props:
        return {}
    out: dict[str, Any] = {}
    for key, value in list(props.items())[:MAX_PROPS_KEYS]:
        if not isinstance(key, str):
            continue
        if isinstance(value, str):
            out[key[:MAX_NAME_LEN]] = value[:MAX_PROP_STR]
        elif isinstance(value, (int, float, bool)) or value is None:
            out[key[:MAX_NAME_LEN]] = value
        # objects / lists are dropped — events stay flat and cheap
    return out


def subject_key(user_id: Optional[uuid.UUID], anon_id: Optional[str]) -> Optional[str]:
    """Retention identity: the user id when logged in, else the anonymous client id.

    Returns None when neither is known — such events can't be attributed and are dropped, never
    stored under a shared bucket (which would poison cohort counts)."""
    if user_id is not None:
        return str(user_id)
    if anon_id:
        return anon_id.strip()[:64] or None
    return None


def build_event_rows(
    raw_events: Iterable[Any],
    *,
    user_id: Optional[uuid.UUID],
    anon_id: Optional[str],
) -> list[Event]:
    """Turn a validated batch (EventIn-like objects with .name/.props) into Event rows.

    Drops events whose name normalizes to empty or that can't be attributed to a subject."""
    subject = subject_key(user_id, anon_id)
    if subject is None:
        return []
    rows: list[Event] = []
    for ev in raw_events:
        name = normalize_name(getattr(ev, "name", "") or "")
        if not name:
            continue
        rows.append(
            Event(
                subject=subject,
                user_id=user_id,
                name=name,
                props=sanitize_props(getattr(ev, "props", None)),
            )
        )
    return rows


def _as_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)).date()


def compute_retention(
    rows: Iterable[tuple[str, Any]],
    *,
    day_n: int = 7,
    window: int = 1,
) -> dict[str, Any]:
    """N-day retention from raw (subject, activity-day) pairs.

    For each subject the first active day is its cohort anchor. A subject is "retained" if it has
    any activity in [anchor + day_n, anchor + day_n + window). With the default window=1 that is
    exactly the day-7 anniversary. Subjects whose anchor is too recent for day_n to have elapsed
    (relative to the latest day seen) are excluded — we can't yet know their outcome.

    Returns {cohort, retained, rate, day_n}. rate is 0.0 when the cohort is empty.
    """
    by_subject: dict[str, set[date]] = {}
    for subject, raw_day in rows:
        by_subject.setdefault(subject, set()).add(_as_date(raw_day))
    if not by_subject:
        return {"cohort": 0, "retained": 0, "rate": 0.0, "day_n": day_n}

    latest = max(d for days in by_subject.values() for d in days)
    cohort = 0
    retained = 0
    for days in by_subject.values():
        anchor = min(days)
        target_start = anchor + timedelta(days=day_n)
        # Outcome only known once the whole return window has elapsed.
        if target_start + timedelta(days=window - 1) > latest:
            continue
        cohort += 1
        target_end = target_start + timedelta(days=window)
        if any(target_start <= d < target_end for d in days):
            retained += 1
    rate = round(retained / cohort, 4) if cohort else 0.0
    return {"cohort": cohort, "retained": retained, "rate": rate, "day_n": day_n}
