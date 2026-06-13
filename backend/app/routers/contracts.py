"""Daily-contract endpoints (engagement v2, Phase 2): daily-return + varied, server-verified earning.

GET  /contracts        today's contracts with live progress (counted from the events table).
POST /contracts/claim  pay koku for a completed contract — once per day, verified server-side.

Koku is server-authoritative, so completion is NEVER trusted from the client: progress is counted
from the EVENTS the app already emits (exercise_answered / session_complete / review_submitted), and
the payout is guarded by the claimed_contracts table (PK conflict = already claimed = pays nothing).
The decidable logic (which contracts today, target math) is the pure services/contracts.py.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import ClaimedContract, Event, User
from ..deps import get_current_user, get_db
from ..schemas import ContractClaimIn, ContractClaimOut, ContractsOut
from ..services import contracts as contracts_service
from ..services.gating import _utc_day

router = APIRouter(prefix="/contracts", tags=["contracts"])


def _day_window(day: str) -> tuple[datetime, datetime]:  # pragma: no cover — DB helper
    """The real-UTC [start, end) range whose events belong to contract-day `day` (offset-aware)."""
    offset = timedelta(minutes=settings.DAY_OFFSET_MIN)
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc) - offset
    return start, start + timedelta(days=1)


async def _counts_today(db: AsyncSession, subject: str, day: str) -> dict[str, int]:  # pragma: no cover — DB
    """Per-metric event counts for this subject today, in the shape the pure layer expects."""
    start, end = _day_window(day)
    correct_sum = func.coalesce(
        func.sum(case((Event.props["correct"].astext == "true", 1), else_=0)), 0
    )
    rows = (
        await db.execute(
            select(Event.name, func.count(), correct_sum)
            .where(Event.subject == subject, Event.ts >= start, Event.ts < end)
            .group_by(Event.name)
        )
    ).all()
    answered = answered_correct = sessions = reviews = 0
    for name, total, correct in rows:
        if name == "exercise_answered":
            answered = total
            answered_correct = correct or 0
        elif name == "session_complete":
            sessions = total
        elif name == "review_submitted":
            reviews = total
    return {
        "answered": answered,
        "answered_correct": answered_correct,
        "sessions": sessions,
        "reviews": reviews,
    }


async def _claimed_today(db: AsyncSession, user_id, day: str) -> set[str]:  # pragma: no cover — DB
    rows = (
        await db.execute(
            select(ClaimedContract.contract_id).where(
                ClaimedContract.user_id == user_id, ClaimedContract.day == day
            )
        )
    ).scalars().all()
    return set(rows)


@router.get("", response_model=ContractsOut)
async def get_contracts(  # pragma: no cover — thin DB layer (pure logic tested separately)
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContractsOut:
    day = _utc_day()
    subject = str(user.id)
    counts = await _counts_today(db, subject, day)
    claimed = await _claimed_today(db, user.id, day)
    contracts = contracts_service.build_today(subject, day, counts, claimed)
    return ContractsOut(day=day, contracts=contracts, coins=user.coins)


@router.post("/claim", response_model=ContractClaimOut)
async def claim_contract(  # pragma: no cover — thin DB layer (pure logic tested separately)
    payload: ContractClaimIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ContractClaimOut:
    """Pay koku for a completed contract. 409 if not completed; idempotent if already claimed."""
    day = _utc_day()
    subject = str(user.id)
    counts = await _counts_today(db, subject, day)
    claimed = await _claimed_today(db, user.id, day)
    if not contracts_service.is_claimable(subject, day, payload.id, counts, claimed):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract not completed.")
    # Guard the payout with the claim row: a PK conflict means a concurrent/duplicate claim → no pay.
    res = await db.execute(
        pg_insert(ClaimedContract)
        .values(user_id=user.id, day=day, contract_id=payload.id)
        .on_conflict_do_nothing(index_elements=["user_id", "day", "contract_id"])
    )
    if res.rowcount == 0:
        await db.rollback()
        return ContractClaimOut(claimed=False, reward=0, coins=user.coins)
    reward = contracts_service.reward_for(payload.id)
    balance = (
        await db.execute(
            update(User).where(User.id == user.id).values(coins=User.coins + reward).returning(User.coins)
        )
    ).scalar_one()
    await db.commit()
    return ContractClaimOut(claimed=True, reward=reward, coins=balance)
