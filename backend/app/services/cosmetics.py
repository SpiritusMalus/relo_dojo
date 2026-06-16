"""Cosmetics — the koku desire sink (engagement v2). Server-authoritative ownership.

Cosmetics are pure sinks: they cost koku and grant no gameplay advantage, so the catalog can be
priced aspirationally without unbalancing the economy. The SERVER owns the catalog (price + gate) so
a patched client can't grant itself a skin or pay the wrong price; the mobile app keeps a parallel
catalog only for rendering (ids must match).

Slots hold one equipped item each (e.g. the "sensei" slot = which mascot skin shows). The starter
item of every slot is implicit: always owned, equipped by default, never stored on the row — so a
fresh account already wears something (endowment effect) with no migration backfill.

Gates:
- "buy"     purchasable with koku (price > 0).
- "starter" the free default of its slot; always owned, can't be bought (price 0).
- "achievement" granted server-side on a qualifying event, never for sale (price 0). None ship in
                the first slice — the field exists so the catalog shape is stable.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User

# Seasonal windows (northern-hemisphere months) — a scarcity/urgency mechanic: a seasonal cosmetic
# can only be bought while its season is active, giving a recurring reason to return and spend.
SEASON_MONTHS: dict[str, set[int]] = {
    "spring": {3, 4, 5},
    "summer": {6, 7, 8},
    "autumn": {9, 10, 11},
    "winter": {12, 1, 2},
}


def is_season_active(season: str | None, now: datetime | None = None) -> bool:
    """True when `season` is None (always available) or the current month falls in its window."""
    if not season:
        return True
    months = SEASON_MONTHS.get(season)
    if not months:
        return True  # unknown season tag → don't lock out (fail open)
    return (now or datetime.now(timezone.utc)).month in months

# id -> {slot, gate, price, season?}. Single source of truth for price + gate.
CATALOG: dict[str, dict[str, Any]] = {
    # Sensei skins (flagship slot — the mascot is on every screen, so highest perceived value).
    "sensei_classic": {"slot": "sensei", "gate": "starter", "price": 0},
    "sensei_sage": {"slot": "sensei", "gate": "buy", "price": 200},
    "sensei_ronin": {"slot": "sensei", "gate": "buy", "price": 250},
    "sensei_sakura": {"slot": "sensei", "gate": "buy", "price": 300, "season": "spring"},
    # Belt-knot styles (shows on the belt icon in the top bar, lists, progress — high daily exposure).
    "knot_classic": {"slot": "knot", "gate": "starter", "price": 0},
    "knot_gold": {"slot": "knot", "gate": "buy", "price": 150},
    "knot_jade": {"slot": "knot", "gate": "buy", "price": 180},
    "knot_tassel": {"slot": "knot", "gate": "buy", "price": 220},
}

_UNKNOWN = "Unknown cosmetic."
_NOT_FOR_SALE = "This cosmetic can't be bought."
_NOT_ENOUGH = "Not enough koku."
_NOT_OWNED = "You don't own this cosmetic."
_OUT_OF_SEASON = "This cosmetic is out of season."


def starter_ids() -> set[str]:
    """The implicit always-owned default of every slot."""
    return {cid for cid, c in CATALOG.items() if c["gate"] == "starter"}


def _starter_for(slot: str) -> str | None:
    for cid, c in CATALOG.items():
        if c["slot"] == slot and c["gate"] == "starter":
            return cid
    return None


def owned_ids(user: User) -> list[str]:
    """Everything the user can equip: implicit starters + purchased/granted ids (deduped, stable)."""
    seen: dict[str, None] = {}
    for cid in list(starter_ids()) + list(user.cosmetics or []):
        if cid in CATALOG:
            seen.setdefault(cid, None)
    return list(seen.keys())


def equipped_resolved(user: User) -> dict[str, str]:
    """Equipped id per slot, falling back to each slot's starter when unset/invalid."""
    out: dict[str, str] = {}
    slots = {c["slot"] for c in CATALOG.values()}
    chosen = user.equipped or {}
    owned = set(owned_ids(user))
    for slot in slots:
        pick = chosen.get(slot)
        if not (isinstance(pick, str) and pick in owned and CATALOG.get(pick, {}).get("slot") == slot):
            pick = _starter_for(slot)
        if pick:
            out[slot] = pick
    return out


def can_buy(user: User, cosmetic_id: str) -> tuple[bool, str]:
    """Pure precheck (no DB write): may this user buy this item now? (ok, reason)."""
    item = CATALOG.get(cosmetic_id)
    if item is None:
        return False, _UNKNOWN
    if item["gate"] != "buy":
        return False, _NOT_FOR_SALE
    if cosmetic_id in owned_ids(user):
        return False, "Already owned."
    if not is_season_active(item.get("season")):
        return False, _OUT_OF_SEASON
    if user.coins < item["price"]:
        return False, _NOT_ENOUGH
    return True, ""


async def buy(user: User, db: AsyncSession, cosmetic_id: str) -> User:
    """Purchase a cosmetic: validate gate/season/price, debit koku, grant ownership — atomically.

    Row-locks the account (SELECT … FOR UPDATE) so concurrent buys serialize. Without the lock two
    buys of the SAME item could both pass the ownership check and double-charge, and two DIFFERENT
    buys could clobber each other's `cosmetics` append (a read-modify-write on the JSONB array).
    409 when too poor (re-checked under the lock)."""
    item = CATALOG.get(cosmetic_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN)
    if item["gate"] != "buy":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_FOR_SALE)
    # Lock the row for the read-modify-write below (ownership re-check + debit + array append).
    await db.refresh(user, with_for_update=True)
    if cosmetic_id in owned_ids(user):
        await db.rollback()  # idempotent: already owned → release the lock, charge nothing
        return user
    if not is_season_active(item.get("season")):
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_OUT_OF_SEASON)
    price = item["price"]
    if user.coins < price:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_ENOUGH)
    user.coins -= price
    user.cosmetics = list(user.cosmetics or []) + [cosmetic_id]
    await db.commit()
    await db.refresh(user)
    return user


async def equip(user: User, db: AsyncSession, cosmetic_id: str) -> User:
    """Equip an owned cosmetic into its slot. 400 if unknown; 409 if not owned."""
    item = CATALOG.get(cosmetic_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN)
    if cosmetic_id not in owned_ids(user):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_OWNED)
    equipped = dict(user.equipped or {})
    equipped[item["slot"]] = cosmetic_id
    user.equipped = equipped
    await db.commit()
    await db.refresh(user)
    return user
