"""Cosmetics service (app.services.cosmetics) — pure layer + buy/equip on a fake DB (no Postgres)."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import cosmetics


class _FakeResult:
    def __init__(self, rowcount: int = 1) -> None:
        self.rowcount = rowcount


class _FakeDB:
    def __init__(self, rowcount: int = 1) -> None:
        self.rowcount = rowcount
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, stmt):  # noqa: ANN001
        return _FakeResult(self.rowcount)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, obj) -> None:  # noqa: ANN001
        pass


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
    db = _FakeDB(rowcount=1)  # guarded debit succeeds
    u = _user(coins=300)
    out = await cosmetics.buy(u, db, "sensei_sage")
    assert "sensei_sage" in out.cosmetics
    assert db.commits == 1


async def test_buy_409_when_insufficient_after_race():
    db = _FakeDB(rowcount=0)  # coins>=price guard failed → lost race / too poor
    with pytest.raises(HTTPException) as ei:
        await cosmetics.buy(_user(coins=300), db, "sensei_sage")
    assert ei.value.status_code == 409
    assert db.rollbacks == 1


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
