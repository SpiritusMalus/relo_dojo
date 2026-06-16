"""Cosmetics service (app.services.cosmetics) — pure layer + buy/equip on a fake DB (no Postgres)."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import cosmetics


# --- seasonal availability ---------------------------------------------------
def test_is_season_active():
    march = datetime(2026, 3, 15, tzinfo=timezone.utc)
    june = datetime(2026, 6, 15, tzinfo=timezone.utc)
    assert cosmetics.is_season_active(None, june) is True  # no season = always
    assert cosmetics.is_season_active("spring", march) is True
    assert cosmetics.is_season_active("spring", june) is False
    assert cosmetics.is_season_active("mystery", june) is True  # unknown tag fails open


async def test_buy_rejects_out_of_season(monkeypatch):
    # Force "now" to summer so the spring-only sakura skin is locked.
    monkeypatch.setattr(
        cosmetics, "datetime",
        SimpleNamespace(now=lambda tz=None: datetime(2026, 7, 1, tzinfo=timezone.utc)),
    )
    db = _FakeDB()
    with pytest.raises(HTTPException) as ei:
        await cosmetics.buy(_user(coins=999), db, "sensei_sakura")
    assert ei.value.status_code == 400


class _FakeDB:
    """Minimal async session: counts commits/rollbacks and FOR UPDATE locks. The buy path now uses
    a row lock + in-Python check (no Core UPDATE), so there's no execute()/rowcount to fake."""

    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.locked = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, obj, **kw) -> None:  # noqa: ANN001 — row-lock no-op in tests
        if kw.get("with_for_update"):
            self.locked += 1


def _user(coins: int = 0, cosmetics=None, equipped=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(), coins=coins, cosmetics=cosmetics or [], equipped=equipped or {}
    )


# --- pure helpers ------------------------------------------------------------
def test_starter_is_always_owned_even_with_empty_row():
    owned = cosmetics.owned_ids(_user())
    assert "sensei_classic" in owned  # the implicit starter, never stored on the row


def test_owned_includes_purchased_and_dedupes():
    u = _user(cosmetics=["sensei_sage", "sensei_sage", "bogus_id"])
    owned = cosmetics.owned_ids(u)
    assert owned.count("sensei_sage") == 1
    assert "sensei_classic" in owned  # starter still present
    assert "bogus_id" not in owned  # unknown ids are filtered out


def test_equipped_defaults_to_starter_when_unset():
    resolved = cosmetics.equipped_resolved(_user())
    assert resolved["sensei"] == "sensei_classic"
    assert resolved["knot"] == "knot_classic"  # every slot resolves to its starter


def test_knot_slot_buy_and_equip():
    # The service is slot-generic: a knot buys/equips exactly like a sensei skin.
    assert cosmetics.can_buy(_user(coins=200), "knot_gold")[0] is True
    assert "knot_classic" in cosmetics.owned_ids(_user())


def test_equipped_falls_back_when_not_owned():
    # Equipped points at an item the user doesn't own → resolve to the slot's starter.
    u = _user(equipped={"sensei": "sensei_sage"})
    assert cosmetics.equipped_resolved(u)["sensei"] == "sensei_classic"


def test_equipped_honours_owned_choice():
    u = _user(cosmetics=["sensei_sage"], equipped={"sensei": "sensei_sage"})
    assert cosmetics.equipped_resolved(u)["sensei"] == "sensei_sage"


def test_can_buy_rules():
    assert cosmetics.can_buy(_user(coins=999), "nope")[0] is False  # unknown
    assert cosmetics.can_buy(_user(coins=999), "sensei_classic")[0] is False  # starter not for sale
    assert cosmetics.can_buy(_user(coins=10), "sensei_sage")[0] is False  # too poor
    assert cosmetics.can_buy(_user(coins=200), "sensei_sage")[0] is True
    owned = _user(coins=999, cosmetics=["sensei_sage"])
    assert cosmetics.can_buy(owned, "sensei_sage")[0] is False  # already owned


# --- buy ---------------------------------------------------------------------
async def test_buy_grants_and_debits_on_success():
    db = _FakeDB()
    u = _user(coins=300)
    out = await cosmetics.buy(u, db, "sensei_sage")  # price 200
    assert "sensei_sage" in out.cosmetics
    assert out.coins == 100  # koku debited
    assert db.commits == 1 and db.locked == 1  # debit + grant under SELECT … FOR UPDATE


async def test_buy_409_when_insufficient():
    db = _FakeDB()
    with pytest.raises(HTTPException) as ei:
        await cosmetics.buy(_user(coins=10), db, "sensei_sage")  # price 200 → too poor
    assert ei.value.status_code == 409
    assert db.commits == 0 and db.rollbacks == 1


async def test_buy_rejects_starter_and_unknown():
    db = _FakeDB()
    with pytest.raises(HTTPException) as e1:
        await cosmetics.buy(_user(coins=999), db, "sensei_classic")
    assert e1.value.status_code == 400
    with pytest.raises(HTTPException) as e2:
        await cosmetics.buy(_user(coins=999), db, "ghost")
    assert e2.value.status_code == 400


async def test_buy_is_idempotent_when_already_owned():
    db = _FakeDB()
    u = _user(coins=300, cosmetics=["sensei_sage"])
    out = await cosmetics.buy(u, db, "sensei_sage")
    assert out.coins == 300 and db.commits == 0  # charged nothing


async def test_buy_serializes_under_a_row_lock():
    # The debit + ownership grant run under SELECT … FOR UPDATE, so two concurrent buys can't
    # double-charge the same item or clobber each other's cosmetics array.
    db = _FakeDB()
    await cosmetics.buy(_user(coins=300), db, "sensei_sage")
    assert db.locked == 1


# --- equip -------------------------------------------------------------------
async def test_equip_owned_sets_slot():
    db = _FakeDB()
    u = _user(cosmetics=["sensei_sage"])
    out = await cosmetics.equip(u, db, "sensei_sage")
    assert out.equipped["sensei"] == "sensei_sage"
    assert db.commits == 1


async def test_equip_starter_always_allowed():
    db = _FakeDB()
    out = await cosmetics.equip(_user(), db, "sensei_classic")
    assert out.equipped["sensei"] == "sensei_classic"


async def test_equip_rejects_unowned_and_unknown():
    db = _FakeDB()
    with pytest.raises(HTTPException) as e1:
        await cosmetics.equip(_user(), db, "sensei_sage")  # not owned
    assert e1.value.status_code == 409
    with pytest.raises(HTTPException) as e2:
        await cosmetics.equip(_user(), db, "ghost")
    assert e2.value.status_code == 400
