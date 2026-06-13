"""Server-side daily gating per account tier (app.services.gating)."""

from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import gating


class _FakeDB:
    def __init__(self) -> None:
        self.commits = 0
        self.locked = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj, **kw) -> None:  # noqa: ANN001 — row-lock no-op in tests
        if kw.get("with_for_update"):
            self.locked += 1


def _user(
    verified: bool, premium: bool = False, day: str = "", used: int = 0
) -> SimpleNamespace:
    return SimpleNamespace(
        is_verified=verified, is_premium=premium, starter_day=day, starter_used=used
    )


def _code(exc_value) -> str | None:
    detail = getattr(exc_value, "detail", None)
    return detail.get("code") if isinstance(detail, dict) else None


def test_require_verified_blocks_only_unverified():
    gating.require_verified(None)  # anonymous: allowed
    gating.require_verified(_user(True))  # verified: allowed
    with pytest.raises(Exception) as exc:
        gating.require_verified(_user(False))
    assert getattr(exc.value, "status_code", None) == 403


async def test_quota_noop_for_anonymous_and_premium():
    db = _FakeDB()
    await gating.consume_daily_exercise(None, db)
    await gating.consume_daily_exercise(_user(True, premium=True), db)
    assert db.commits == 0  # nothing metered


async def test_starter_quota_counts_and_blocks_unverified(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_DAILY_LIMIT", 2)
    db = _FakeDB()
    u = _user(False)
    await gating.consume_daily_exercise(u, db)  # 1
    await gating.consume_daily_exercise(u, db)  # 2
    assert u.starter_used == 2
    with pytest.raises(Exception) as exc:
        await gating.consume_daily_exercise(u, db)  # over limit
    assert getattr(exc.value, "status_code", None) == 403
    assert _code(exc.value) == "starter_limit"


async def test_free_quota_counts_and_blocks_verified(monkeypatch):
    monkeypatch.setattr(settings, "FREE_DAILY_LIMIT", 3)
    db = _FakeDB()
    u = _user(True)
    for _ in range(3):
        await gating.consume_daily_exercise(u, db)
    with pytest.raises(Exception) as exc:
        await gating.consume_daily_exercise(u, db)
    assert getattr(exc.value, "status_code", None) == 403
    assert _code(exc.value) == "daily_limit"


async def test_metered_consume_takes_a_row_lock(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_DAILY_LIMIT", 5)
    db = _FakeDB()
    await gating.consume_daily_exercise(_user(False), db)
    assert db.locked == 1  # SELECT ... FOR UPDATE serializes concurrent requests


async def test_quota_resets_on_new_day(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_DAILY_LIMIT", 2)
    db = _FakeDB()
    u = _user(False, day="2000-01-01", used=99)  # stale day with a maxed counter
    await gating.consume_daily_exercise(u, db)
    assert u.starter_used == 1  # reset, then counted today


def test_left_today_tiers(monkeypatch):
    monkeypatch.setattr(settings, "FREE_DAILY_LIMIT", 20)
    assert gating.left_today(None) is None  # anonymous: unmetered
    assert gating.left_today(_user(True, premium=True)) is None  # premium: unlimited
    assert gating.left_today(_user(True)) == 20  # fresh day: full allowance
    today = gating._utc_day()
    assert gating.left_today(_user(True, day=today, used=15)) == 5
    assert gating.left_today(_user(True, day=today, used=99)) == 0  # never negative
    # extra_pack drives used negative → headroom above the base limit
    assert gating.left_today(_user(True, day=today, used=-10)) == 30
