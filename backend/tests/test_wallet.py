"""Koku wallet service (app.services.wallet) — pure layer, fake DB (no real Postgres)."""

import uuid
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import wallet


class _FakeResult:
    def __init__(self, rowcount: int = 1, scalar: int | None = None) -> None:
        self.rowcount = rowcount
        self._scalar = scalar

    def scalar_one(self) -> int:
        return self._scalar


class _FakeDB:
    """Records calls; `rowcount`/`scalar` configure what execute() reports back."""

    def __init__(self, rowcount: int = 1, scalar: int | None = None) -> None:
        self.rowcount = rowcount
        self.scalar = scalar
        self.commits = 0
        self.rollbacks = 0
        self.refreshed = False

    async def execute(self, stmt):  # noqa: ANN001 — SQLAlchemy statement, unused in the fake
        return _FakeResult(self.rowcount, self.scalar)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, obj) -> None:  # noqa: ANN001
        self.refreshed = True


def _user() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), coins=0, freezes=0, is_premium=False)


async def test_award_anonymous_is_zero():
    db = _FakeDB()
    earned, balance = await wallet.award_correct_check(None, db)
    assert (earned, balance) == (0, None)
    assert db.commits == 0  # nothing written for anonymous callers


async def test_award_credits_and_returns_new_balance():
    db = _FakeDB(scalar=42)
    earned, balance = await wallet.award_correct_check(_user(), db)
    assert earned == settings.COIN_REWARD_CORRECT
    assert balance == 42  # the post-update balance comes from the DB, not the stale ORM object
    assert db.commits == 1


async def test_spend_unknown_item_is_400():
    db = _FakeDB()
    with pytest.raises(Exception) as exc:
        await wallet.spend(_user(), db, "loot_box", 1)
    assert getattr(exc.value, "status_code", None) == 400
    assert db.commits == 0


async def test_spend_insufficient_balance_is_409_and_rolls_back():
    db = _FakeDB(rowcount=0)  # guarded UPDATE matched no row → not enough koku
    with pytest.raises(Exception) as exc:
        await wallet.spend(_user(), db, "omamori", 1)
    assert getattr(exc.value, "status_code", None) == 409
    assert db.rollbacks == 1
    assert db.commits == 0


async def test_spend_success_commits_and_refreshes():
    db = _FakeDB(rowcount=1)
    user = _user()
    out = await wallet.spend(user, db, "omamori", 2)
    assert out is user
    assert db.commits == 1
    assert db.refreshed


async def test_use_freeze_without_charms_is_409():
    db = _FakeDB(rowcount=0)
    with pytest.raises(Exception) as exc:
        await wallet.spend(_user(), db, "use_freeze", 1)
    assert getattr(exc.value, "status_code", None) == 409
