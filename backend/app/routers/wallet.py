"""Wallet endpoints (economy, branch 1): balance + spend. Auth required."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import SpendIn, WalletOut
from ..services import wallet as wallet_service
from ..services.gating import left_today

router = APIRouter(prefix="/wallet", tags=["wallet"])


def _out(user: User) -> WalletOut:
    return WalletOut(
        coins=user.coins,
        freezes=user.freezes,
        is_premium=user.is_premium,
        left_today=left_today(user),
    )


@router.get("", response_model=WalletOut)
async def get_wallet(user: User = Depends(get_current_user)) -> WalletOut:
    return _out(user)


@router.post("/spend", response_model=WalletOut)
async def spend(
    payload: SpendIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WalletOut:
    """Buy/consume a catalog item. 409 if the balance is insufficient (client shows the shop)."""
    user = await wallet_service.spend(user, db, payload.item, payload.qty)
    return _out(user)
