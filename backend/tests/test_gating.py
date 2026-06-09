"""Server-side starter gating for unverified accounts (app.services.gating)."""

from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import gating


class _FakeDB:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _user(verified: bool, day: str = "", used: int = 0) -> SimpleNamespace:
    return SimpleNamespace(is_verified=verified, starter_day=day, starter_used=used)


def test_require_verified_blocks_only_unverified():
    gating.require_verified(None)  # anonymous: allowed
    gating.require_verified(_user(True))  # verified: allowed
    with pytest.raises(Exception) as exc:
        gating.require_verified(_user(False))
    assert getattr(exc.value, "status_code", None) == 403


async def test_starter_quota_noop_for_verified_and_anonymous():
    db = _FakeDB()
    await gating.consume_starter_exercise(None, db)
    await gating.consume_starter_exercise(_user(True), db)
    assert db.commits == 0  # nothing metered


async def test_starter_quota_counts_and_blocks(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_DAILY_LIMIT", 2)
    db = _FakeDB()
    u = _user(False)
    await gating.consume_starter_exercise(u, db)  # 1
    await gating.consume_starter_exercise(u, db)  # 2
    assert u.starter_used == 2
    with pytest.raises(Exception) as exc:
        await gating.consume_starter_exercise(u, db)  # over limit
    assert getattr(exc.value, "status_code", None) == 403


async def test_starter_quota_resets_on_new_day(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_DAILY_LIMIT", 2)
    db = _FakeDB()
    u = _user(False, day="2000-01-01", used=99)  # stale day with a maxed counter
    await gating.consume_starter_exercise(u, db)
    assert u.starter_used == 1  # reset, then counted today
