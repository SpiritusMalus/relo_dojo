"""Analytics event ingestion + retention readout (north-star: Day-7 retention).

POST /events is open to anonymous callers (events fire before login); when a bearer token is
present the events are attributed to the user id instead of the anonymous client id. The endpoint
is best-effort: a bad batch never breaks the app, and ingestion failures are swallowed so a
logging outage can't take down the lesson flow.

GET /events/retention is a dev/admin readout, gated by ANALYTICS_ADMIN (404 when off, like
/dev/premium) — the heavy lifting is the pure `compute_retention`; the DB part is a thin query.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import Event, User
from ..deps import get_current_user, get_current_user_optional, get_db
from ..schemas import EventAck, EventBatchIn
from ..services import analytics

router = APIRouter(prefix="/events", tags=["events"])

_log = logging.getLogger("uvicorn.error")


@router.post("", response_model=EventAck)
async def ingest_events(
    payload: EventBatchIn,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
) -> EventAck:
    """Store a batch of analytics events. Anonymous allowed; auth attributes to the user id."""
    rows = analytics.build_event_rows(
        payload.events,
        user_id=user.id if user is not None else None,
        anon_id=payload.anon_id,
    )
    if not rows:
        return EventAck(accepted=0)
    try:
        db.add_all(rows)
        await db.commit()
    except Exception:  # pragma: no cover — analytics must never break the app
        await db.rollback()
        _log.exception("Event ingestion failed — dropping batch of %d.", len(rows))
        return EventAck(accepted=0)
    return EventAck(accepted=len(rows))


@router.get("/retention")
async def retention(
    day: int = Query(default=7, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Day-N retention over all stored events (dev/admin only). Cohort = first-seen day per
    subject; retained = any activity on the day-N anniversary."""
    if not settings.ANALYTICS_ADMIN:  # pragma: no cover — config gate
        raise HTTPException(status_code=404, detail="Not found.")
    day_col = func.date(Event.ts)
    result = await db.execute(select(Event.subject, day_col).distinct())  # pragma: no cover — DB
    pairs = [(subject, d) for subject, d in result.all()]  # pragma: no cover — DB
    return analytics.compute_retention(pairs, day_n=day)  # pragma: no cover — DB
