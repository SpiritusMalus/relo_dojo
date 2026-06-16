"""Phase 3 — content unlocks + story arc rotation (pure layer + buy on a fake DB)."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import content, stories


class _FakeDB:
    """Minimal async session: counts commits/rollbacks and FOR UPDATE locks. The buy path now uses
    a row lock + in-Python check (no Core UPDATE), so there's no execute()/rowcount to fake."""

    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.locked = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, obj, **kw):  # noqa: ANN001 — row-lock no-op in tests
        if kw.get("with_for_update"):
            self.locked += 1


def _user(coins: int = 0, unlocks=None):
    return SimpleNamespace(id=uuid.uuid4(), coins=coins, unlocks=unlocks or [])


# --- stories availability + rotation ----------------------------------------
def test_free_arcs_available_locked_need_unlock():
    free = stories._BY_ID["moving-day"]
    premium = stories._BY_ID["midnight-detective"]
    assert stories.is_available(free, set()) is True
    assert stories.is_available(premium, set()) is False
    assert stories.is_available(premium, {"arc_detective"}) is True


def test_available_ids_grows_with_unlocks():
    base = set(stories.available_ids(set()))
    witharc = set(stories.available_ids({"arc_detective"}))
    assert "midnight-detective" not in base
    assert "midnight-detective" in witharc


def test_featured_is_deterministic_and_available():
    a = stories.featured_story_id("u1", "2026-06-13", set())
    b = stories.featured_story_id("u1", "2026-06-13", set())
    assert a == b and a in stories.available_ids(set())
    # A locked arc can only be featured once it's owned.
    locked_owner = stories.featured_story_id("u1", "2026-06-13", {"arc_detective"})
    assert locked_owner in stories.available_ids({"arc_detective"})


def test_featured_varies_by_day():
    days = {stories.featured_story_id("u1", f"2026-06-{d:02d}", set()) for d in range(1, 15)}
    assert len(days) > 1  # rotates across days


def test_every_premium_arc_unlock_exists_in_catalog():
    # An arc with an `unlock` that isn't a real catalog id would be permanently unbuyable.
    arc_unlocks = {s["unlock"] for s in stories.SCENARIOS if "unlock" in s}
    assert arc_unlocks <= set(content.CATALOG)
    # And every story-arc catalog entry should back a real arc.
    arc_catalog = {cid for cid, item in content.CATALOG.items() if item["kind"] == "story_arc"}
    assert arc_catalog == arc_unlocks


def test_new_premium_arcs_are_gated_until_unlocked():
    for sid, unlock in (("orbital-emergency", "arc_space"), ("the-verdict", "arc_courtroom")):
        arc = stories._BY_ID[sid]
        assert stories.is_available(arc, set()) is False
        assert stories.is_available(arc, {unlock}) is True


# --- content buy ------------------------------------------------------------
def test_can_buy_rules():
    assert content.can_buy(_user(coins=999), "ghost")[0] is False
    assert content.can_buy(_user(coins=10), "arc_detective")[0] is False  # too poor
    assert content.can_buy(_user(coins=200), "arc_detective")[0] is True
    assert content.can_buy(_user(coins=999, unlocks=["arc_detective"]), "arc_detective")[0] is False


async def test_buy_grants_and_debits():
    db = _FakeDB()
    u = _user(coins=200)
    out = await content.buy(u, db, "arc_detective")  # price 200
    assert "arc_detective" in out.unlocks
    assert out.coins == 0  # koku debited
    assert db.commits == 1 and db.locked == 1  # debit + grant under SELECT … FOR UPDATE


async def test_buy_409_when_insufficient():
    db = _FakeDB()
    with pytest.raises(HTTPException) as ei:
        await content.buy(_user(coins=10), db, "arc_detective")  # price 200 → too poor
    assert ei.value.status_code == 409
    assert db.commits == 0 and db.rollbacks == 1


async def test_buy_unknown_is_400():
    db = _FakeDB()
    with pytest.raises(HTTPException) as ei:
        await content.buy(_user(coins=999), db, "ghost")
    assert ei.value.status_code == 400


async def test_buy_idempotent_when_owned():
    db = _FakeDB()
    u = _user(coins=200, unlocks=["arc_detective"])
    out = await content.buy(u, db, "arc_detective")
    assert out.coins == 200 and db.commits == 0
