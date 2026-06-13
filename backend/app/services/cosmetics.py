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

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User

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
    if user.coins < item["price"]:
        return False, _NOT_ENOUGH
    return True, ""


async def buy(user: User, db: AsyncSession, cosmetic_id: str) -> User:
    """Purchase a cosmetic: validate gate/price, debit koku, grant ownership — atomically.

    The coin debit is a guarded UPDATE (coins >= price), so two concurrent buys can't overspend; on
    a lost race rowcount==0 → 409, nothing granted."""
    item = CATALOG.get(cosmetic_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN)
    if item["gate"] != "buy":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_FOR_SALE)
    if cosmetic_id in owned_ids(user):
        # Idempotent: already owned → return current state, charge nothing.
        return user
    price = item["price"]
    res = await db.execute(
        update(User).where(User.id == user.id, User.coins >= price).values(coins=User.coins - price)
    )
    if res.rowcount == 0:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_ENOUGH)
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
