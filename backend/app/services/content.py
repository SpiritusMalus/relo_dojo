"""Content unlocks (engagement v2, Phase 3) — koku buys *new content*, closing earn→spend→novelty.

Server-authoritative, mirroring cosmetics: the catalog (id + price) lives here, ownership lives on
`User.unlocks`, and the koku debit is a guarded UPDATE so it can't be overspent or client-faked.
Today these unlock premium story arcs (see stories.SCENARIOS `unlock` ids); the shape is generic so
topic packs / hard modes can be added later.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User

# content id -> {kind, price, title}. `kind` lets the client group catalog entries.
CATALOG: dict[str, dict[str, Any]] = {
    "arc_detective": {"kind": "story_arc", "price": 200, "title": "The midnight case"},
    "arc_space": {"kind": "story_arc", "price": 200, "title": "Orbital emergency"},
    "arc_courtroom": {"kind": "story_arc", "price": 250, "title": "The verdict"},
}

_UNKNOWN = "Unknown content."
_NOT_ENOUGH = "Not enough koku."


def owned_ids(user: User) -> list[str]:
    """Valid unlock ids the user owns (filtered against the catalog)."""
    return [cid for cid in (user.unlocks or []) if cid in CATALOG]


def can_buy(user: User, content_id: str) -> tuple[bool, str]:
    item = CATALOG.get(content_id)
    if item is None:
        return False, _UNKNOWN
    if content_id in owned_ids(user):
        return False, "Already owned."
    if user.coins < item["price"]:
        return False, _NOT_ENOUGH
    return True, ""


async def buy(user: User, db: AsyncSession, content_id: str) -> User:
    """Unlock content with koku — validate, lock, debit, grant ownership, atomically.

    Row-locks the account (SELECT … FOR UPDATE) so concurrent buys serialize. Without the lock two
    buys of the same id could double-charge, and two different buys could clobber each other's
    `unlocks` append (a read-modify-write on the JSONB array). 409 when too poor."""
    item = CATALOG.get(content_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN)
    # Lock the row for the read-modify-write below (ownership re-check + debit + array append).
    await db.refresh(user, with_for_update=True)
    if content_id in owned_ids(user):
        await db.rollback()  # idempotent: already owned → release the lock, charge nothing
        return user
    price = item["price"]
    if user.coins < price:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_ENOUGH)
    user.coins -= price
    user.unlocks = list(user.unlocks or []) + [content_id]
    await db.commit()
    await db.refresh(user)
    return user
