"""Cosmetics endpoints (engagement v2): the koku desire sink. Auth required.

GET  /cosmetics        owned ids (incl. implicit starters) + equipped per slot.
POST /cosmetics/buy    purchase a cosmetic with koku (server validates price + gate).
POST /cosmetics/equip  equip an owned cosmetic into its slot.

The catalog (price/gate) lives server-side in services/cosmetics.py — the client mirrors it only
for rendering. Ownership is server-authoritative: nothing here trusts a client-supplied price.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import CosmeticIn, CosmeticsOut
from ..services import cosmetics as cosmetics_service

router = APIRouter(prefix="/cosmetics", tags=["cosmetics"])


def _out(user: User) -> CosmeticsOut:
    return CosmeticsOut(
        owned=cosmetics_service.owned_ids(user),
        equipped=cosmetics_service.equipped_resolved(user),
    )


@router.get("", response_model=CosmeticsOut)
async def get_cosmetics(user: User = Depends(get_current_user)) -> CosmeticsOut:
    return _out(user)


@router.post("/buy", response_model=CosmeticsOut)
async def buy_cosmetic(
    payload: CosmeticIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CosmeticsOut:
    """Buy a cosmetic. 400 unknown/not-for-sale; 409 insufficient koku (client shows the shop)."""
    user = await cosmetics_service.buy(user, db, payload.id)
    return _out(user)


@router.post("/equip", response_model=CosmeticsOut)
async def equip_cosmetic(
    payload: CosmeticIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CosmeticsOut:
    """Equip an owned cosmetic. 400 unknown; 409 not owned."""
    user = await cosmetics_service.equip(user, db, payload.id)
    return _out(user)
