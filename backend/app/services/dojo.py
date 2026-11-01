"""My Dojo: server-confirmed practice days and the existing cosmetic inventory.

Only newly issued, owner/session-bound exercises can advance these milestones. Mutable progress,
analytics, koku anti-replay rows and past exams are deliberately not sources of this evidence.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import DojoGrant, DojoPracticeDay, LearningIssuedItem, LearningSession, User
from ..schemas import DojoCatalogItem, DojoReceipt, DojoState, LearningSessionOut
from . import cosmetics, tokens

SLOTS = ["dojo_light", "dojo_display", "dojo_plant"]
SESSION_ITEMS = 10
SESSION_HOURS = 24
SESSION_RETENTION_DAYS = 60  # longer than the scoped review-token lifetime (35 days)
MAX_ISSUED_ITEMS = 50  # allows adaptive prefetch/swerve replacements, with a bounded footprint
MAX_OPEN_SESSIONS = 5
MILESTONES = {1: "dojo_display_first_scroll", 3: "dojo_plant_bamboo", 7: "dojo_light_lantern"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def ensure_enabled() -> None:
    if not settings.DOJO_ENABLED:
        raise HTTPException(404, detail="My Dojo is unavailable.")


def _bad(detail: str, code: int = 409) -> None:
    raise HTTPException(code, detail=detail)


def _expired() -> None:
    raise HTTPException(410, detail={"code": "learning_session_expired", "message": "This practice session has expired."})


def session_out(row: LearningSession) -> LearningSessionOut:
    return LearningSessionOut(id=str(row.id), expires_at=_aware(row.expires_at).isoformat(),
                              graded_count=len(row.grades or {}), completed=row.completed_at is not None,
                              reward_day=row.reward_day)


async def get_session(user: User | None, db: AsyncSession, session_id: uuid.UUID,
                      *, lock: bool = False, active: bool = False,
                      require_enabled: bool = True) -> LearningSession:
    if require_enabled:
        ensure_enabled()
    if user is None:
        _bad("Sign in to save practice evidence.", 401)
    stmt = select(LearningSession).where(LearningSession.id == session_id, LearningSession.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        _bad("Practice session not found.", 404)
    if active and row.completed_at is not None:
        _bad("This practice session is finished.")
    if active and _aware(row.expires_at) <= now_utc():
        _expired()
    return row


async def start_session(user: User, db: AsyncSession, client_id: uuid.UUID) -> LearningSession:
    ensure_enabled()
    # Lock the owner for idempotent creation, and share the same lock order as completion.
    await db.refresh(user, with_for_update=True)
    now = now_utc()
    await db.execute(delete(LearningSession).where(LearningSession.user_id == user.id,
                                                   LearningSession.created_at < now - timedelta(days=SESSION_RETENTION_DAYS))
                     .execution_options(synchronize_session=False))
    old = (await db.execute(select(LearningSession).where(LearningSession.user_id == user.id,
                                                        LearningSession.client_id == client_id))).scalar_one_or_none()
    if old is not None:
        await db.commit()
        return old
    count = (await db.execute(select(func.count()).select_from(LearningSession).where(
        LearningSession.user_id == user.id, LearningSession.completed_at.is_(None),
        LearningSession.expires_at > now))).scalar_one()
    if count >= MAX_OPEN_SESSIONS:
        _bad("Finish a current practice session before starting another.")
    row = LearningSession(id=uuid.uuid4(), user_id=user.id, client_id=client_id,
                          created_at=now, expires_at=now + timedelta(hours=SESSION_HOURS), grades={})
    db.add(row)
    await db.commit()
    return row


async def prepare_issue(user: User | None, db: AsyncSession, session_id: uuid.UUID | None,
                        ordinal: int | None) -> None:
    if session_id is None and ordinal is None:
        return
    if session_id is None or ordinal is None:
        _bad("A practice session and item ordinal are required together.", 422)
    if not settings.DOJO_ENABLED:
        return  # capability rollback keeps generation usable, without issuing new evidence
    row = await get_session(user, db, session_id, active=True)
    if str(ordinal) in (row.grades or {}):
        _bad("This practice item was already answered.")


async def bind_exercise(user: User, db: AsyncSession, session_id: uuid.UUID, ordinal: int,
                        data: dict[str, Any], lang: str | None) -> dict[str, Any]:
    row = await get_session(user, db, session_id, lock=True, active=True)
    if str(ordinal) in (row.grades or {}):
        _bad("This practice item was already answered.")
    count = (await db.execute(select(func.count()).select_from(LearningIssuedItem).where(
        LearningIssuedItem.session_id == row.id))).scalar_one()
    if count >= MAX_ISSUED_ITEMS:
        _bad("This practice session has reached its replacement limit.")
    if data.get("token"):
        sealed = tokens.unseal(data["token"])
    elif data.get("type") == "free-text":
        sealed = {"t": "dojo-free-text", "text": data.get("text", ""), "lang": lang}
    else:
        _bad("This exercise does not support practice evidence.", 400)
    item_id = uuid.uuid4()
    # Separate regrading identity: does not expire with the session and cannot advance the dojo.
    # tokens.unseal still applies the existing global exercise TTL unchanged.
    bound = {**sealed, "_dojo": {"v": 1, "session": str(row.id), "owner": str(user.id),
                                "item": str(item_id), "ordinal": ordinal}}
    token = tokens.seal(bound)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    review_token = tokens.seal({**sealed, "_dojo_review_owner": str(user.id), "_dojo_review_v": 1,
                               "_dojo_reward_jti": token_hash, "_dojo_reward_item": str(item_id)})
    db.add(LearningIssuedItem(id=item_id, session_id=row.id, ordinal=ordinal,
                             token_hash=token_hash, rewarded=False,
                             exercise_type=data.get("type", "")))
    await db.commit()
    return {**data, "token": token, "review_token": review_token}


async def validate_grade(user: User | None, db: AsyncSession, sealed: dict, token: str) -> tuple[uuid.UUID, int, str] | None:
    review_owner = sealed.get("_dojo_review_owner")
    if review_owner is not None:
        if user is None or str(user.id) != review_owner or sealed.get("_dojo_review_v") != 1:
            _bad("This review item belongs to another account.", 403)
        return None
    evidence = sealed.get("_dojo")
    if evidence is None:
        return None  # legacy grading semantics are unchanged
    if not isinstance(evidence, dict) or evidence.get("v") != 1 or user is None or evidence.get("owner") != str(user.id):
        _bad("This practice item belongs to another account.", 403)
    try:
        session_id, item_id = uuid.UUID(evidence["session"]), uuid.UUID(evidence["item"])
        ordinal = evidence["ordinal"]
        if not isinstance(ordinal, int) or isinstance(ordinal, bool) or not 0 <= ordinal < SESSION_ITEMS:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        _bad("Invalid practice evidence.", 400)
    row = await get_session(user, db, session_id, require_enabled=False)
    if _aware(row.expires_at) <= now_utc():
        _expired()
    item = (await db.execute(select(LearningIssuedItem).where(
        LearningIssuedItem.id == item_id, LearningIssuedItem.session_id == row.id,
        LearningIssuedItem.ordinal == ordinal))).scalar_one_or_none()
    if item is None or item.token_hash != hashlib.sha256(token.encode()).hexdigest():
        _bad("This practice item was not issued for this session.", 400)
    return (row.id, ordinal, str(item.id)) if settings.DOJO_ENABLED else None


async def record_grade(user: User | None, db: AsyncSession, evidence: tuple[uuid.UUID, int, str] | None,
                       correct: bool) -> None:
    if evidence is None or not settings.DOJO_ENABLED:
        return
    session_id, ordinal, item_id = evidence
    row = await get_session(user, db, session_id, lock=True)
    if _aware(row.expires_at) <= now_utc():
        _expired()
    # The first valid graded item fixes evidence, including wrong answers. Later correction and
    # regrading remain useful but cannot rewrite first-attempt evidence or add another ordinal.
    grades = dict(row.grades or {})
    if str(ordinal) not in grades and row.completed_at is None:
        grades[str(ordinal)] = {"item": item_id, "correct": bool(correct), "graded_at": now_utc().isoformat()}
        row.grades = grades
    await db.commit()


async def state(user: User, db: AsyncSession) -> DojoState:
    ensure_enabled()
    count = (await db.execute(select(func.count()).select_from(DojoPracticeDay).where(
        DojoPracticeDay.user_id == user.id))).scalar_one()
    grants = (await db.execute(select(DojoGrant).where(DojoGrant.user_id == user.id,
        DojoGrant.acknowledged_at.is_(None)).order_by(DojoGrant.granted_at, DojoGrant.rule_id))).scalars().all()
    catalog = [DojoCatalogItem(id=cid, **item) for cid, item in cosmetics.CATALOG.items() if item["slot"] in SLOTS]
    owned = cosmetics.owned_ids(user)
    target = getattr(user, "dojo_target", None)
    target_item = cosmetics.CATALOG.get(target)
    # Read-only compatibility for preferences saved before acquisition/selection guards existed.
    if target in owned or target_item is None or target_item["slot"] not in SLOTS or target_item["gate"] == "starter":
        target = None
    return DojoState(slots=SLOTS, catalog=catalog, owned=owned,
        equipped=cosmetics.equipped_resolved(user), selected_target=target,
        practice_days=count, next_milestone=next((day for day in MILESTONES if day > count), None),
        receipts=[DojoReceipt(id=str(g.id), item_id=g.item_id, rule_id=g.rule_id,
                             practice_days=g.practice_days, granted_at=_aware(g.granted_at).isoformat()) for g in grants])


async def complete_session(user: User, db: AsyncSession, session_id: uuid.UUID) -> LearningSession:
    ensure_enabled()
    await db.refresh(user, with_for_update=True)
    row = await get_session(user, db, session_id, lock=True)
    if row.completed_at is not None:
        await db.commit()
        return row
    now = now_utc()
    if _aware(row.expires_at) <= now:
        _expired()
    if set(row.grades or {}) != {str(i) for i in range(SESSION_ITEMS)}:
        _bad("Finish all ten practice items before completing this session.")
    day = now.date().isoformat()  # Explicit UTC reward day; independent from local streak calendar.
    if await db.get(DojoPracticeDay, (user.id, day)) is None:
        db.add(DojoPracticeDay(user_id=user.id, day=day))
        await db.flush()
    count = (await db.execute(select(func.count()).select_from(DojoPracticeDay).where(
        DojoPracticeDay.user_id == user.id))).scalar_one()
    for threshold, item_id in MILESTONES.items():
        if count < threshold:
            continue
        rule_id = f"practice_days_{threshold}"
        old = (await db.execute(select(DojoGrant).where(DojoGrant.user_id == user.id,
                DojoGrant.rule_id == rule_id, DojoGrant.item_id == item_id))).scalar_one_or_none()
        if old is None:
            db.add(DojoGrant(id=uuid.uuid4(), user_id=user.id, rule_id=rule_id, item_id=item_id,
                             practice_days=threshold, granted_at=now))
            user.cosmetics = list(dict.fromkeys([*(user.cosmetics or []), item_id]))
            if user.dojo_target == item_id:
                user.dojo_target = None
    row.completed_at, row.reward_day = now, day
    await db.commit()  # completion + day + grant + existing inventory are one transaction
    return row


async def select_target(user: User, db: AsyncSession, item_id: str | None) -> DojoState:
    ensure_enabled()
    if item_id is not None:
        item = cosmetics.CATALOG.get(item_id)
        if item is None or item["slot"] not in SLOTS or item["gate"] == "starter":
            _bad("Choose a selectable dojo item.", 400)
    await db.refresh(user, with_for_update=True)
    if item_id is not None and item_id in cosmetics.owned_ids(user):
        _bad("You already own this dojo item.")
    user.dojo_target = item_id
    await db.commit()
    return await state(user, db)


async def abandon_session(user: User, db: AsyncSession, session_id: uuid.UUID) -> LearningSession:
    """Release unfinished-session capacity while retaining issued/review/reward identities.

    Ten verified answers remain recoverable if navigation races completion. Leaving a screen is
    never allowed to discard an already earned completion or a committed item.
    """
    row = await get_session(user, db, session_id, lock=True)
    if row.completed_at is None and len(row.grades or {}) < SESSION_ITEMS:
        row.expires_at = min(_aware(row.expires_at), now_utc())
    await db.commit()
    return row


async def acknowledge(user: User, db: AsyncSession, receipt_id: uuid.UUID) -> DojoState:
    ensure_enabled()
    row = (await db.execute(select(DojoGrant).where(DojoGrant.id == receipt_id,
                                                   DojoGrant.user_id == user.id).with_for_update())).scalar_one_or_none()
    if row is None:
        _bad("Reward receipt not found.", 404)
    if row.acknowledged_at is None:
        row.acknowledged_at = now_utc()
    await db.commit()
    return await state(user, db)


async def export_data(user: User, db: AsyncSession) -> dict:
    """Privacy export works even when the presentation capability is disabled."""
    sessions = (await db.execute(select(LearningSession).where(LearningSession.user_id == user.id))).scalars().all()
    ids = [s.id for s in sessions]
    issued = (await db.execute(select(LearningIssuedItem).where(LearningIssuedItem.session_id.in_(ids)))).scalars().all() if ids else []
    days = (await db.execute(select(DojoPracticeDay.day).where(DojoPracticeDay.user_id == user.id))).scalars().all()
    grants = (await db.execute(select(DojoGrant).where(DojoGrant.user_id == user.id))).scalars().all()
    return {"version": 1, "selected_target": getattr(user, "dojo_target", None), "practice_days": sorted(days),
        "sessions": [{**session_out(s).model_dump(), "client_id": str(s.client_id), "created_at": _aware(s.created_at).isoformat(),
                      "grades": s.grades} for s in sessions],
        "issued_items": [{"id": str(i.id), "session_id": str(i.session_id), "ordinal": i.ordinal,
                          "exercise_type": i.exercise_type} for i in issued],
        "grants": [{"id": str(g.id), "item_id": g.item_id, "rule_id": g.rule_id, "practice_days": g.practice_days,
                    "granted_at": _aware(g.granted_at).isoformat(),
                    "acknowledged_at": _aware(g.acknowledged_at).isoformat() if g.acknowledged_at else None} for g in grants]}
