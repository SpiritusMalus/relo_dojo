"""Content unlocks (engagement v2, Phase 3) — koku buys *new content*, closing earn→spend→novelty.

Server-authoritative, mirroring cosmetics: the catalog (id + price) lives here, ownership lives on
`User.unlocks`, and the koku debit is a guarded UPDATE so it can't be overspent or client-faked.
Today these unlock premium story arcs (see stories.SCENARIOS `unlock` ids); the shape is generic so
topic packs / hard modes can be added later.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User

# content id -> {kind, price, title}. `kind` lets the client group catalog entries.
CATALOG: dict[str, dict[str, Any]] = {
    "arc_detective": {"kind": "story_arc", "price": 200, "title": "The midnight case"},
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
    """Unlock content with koku — validate, debit (guarded), grant ownership, atomically."""
    item = CATALOG.get(content_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN)
    if content_id in owned_ids(user):
        return user  # idempotent — already owned, charge nothing
    price = item["price"]
    res = await db.execute(
        update(User).where(User.id == user.id, User.coins >= price).values(coins=User.coins - price)
    )
    if res.rowcount == 0:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NOT_ENOUGH)
    user.unlocks = list(user.unlocks or []) + [content_id]
    await db.commit()
    await db.refresh(user)
    return user
