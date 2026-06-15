"""Rewarded-ad koku grant (app.services.ads) — server-authoritative, daily-capped."""

from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import ads, gating


class _FakeDB:
    def __init__(self) -> None:
        self.commits = 0
        self.locked = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj, **kw) -> None:  # noqa: ANN001 — row-lock no-op in tests
        if kw.get("with_for_update"):
            self.locked += 1


def _user(day: str = "", used: int = 0, coins: int = 0) -> SimpleNamespace:
    return SimpleNamespace(ad_reward_day=day, ad_rewards_used=used, coins=coins)


async def test_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "ADS_REWARDS_PER_DAY", 0)
    with pytest.raises(Exception) as exc:
        await ads.grant_rewarded(_user(), _FakeDB())
    assert getattr(exc.value, "status_code", None) == 403
    assert exc.value.detail["code"] == "ads_disabled"


async def test_grants_credit_koku_up_to_the_daily_cap(monkeypatch):
    monkeypatch.setattr(settings, "ADS_REWARDS_PER_DAY", 2)
    monkeypatch.setattr(settings, "ADS_REWARD_KOKU", 5)
    db = _FakeDB()
    u = _user()
    r1 = await ads.grant_rewarded(u, db)
    assert r1 == {"amount": 5, "coins": 5, "left_today": 1}
    r2 = await ads.grant_rewarded(u, db)
    assert r2["coins"] == 10 and r2["left_today"] == 0
    with pytest.raises(Exception) as exc:
        await ads.grant_rewarded(u, db)
    assert exc.value.detail["code"] == "ads_limit"
    assert u.coins == 10  # the blocked attempt credited nothing


async def test_cap_resets_on_a_new_day(monkeypatch):
    monkeypatch.setattr(settings, "ADS_REWARDS_PER_DAY", 1)
    monkeypatch.setattr(settings, "ADS_REWARD_KOKU", 7)
    db = _FakeDB()
    u = _user(day="2000-01-01", used=99)  # stale, maxed
    r = await ads.grant_rewarded(u, db)
    assert r["coins"] == 7 and u.ad_reward_day == gating._utc_day()


async def test_grant_takes_a_row_lock(monkeypatch):
    monkeypatch.setattr(settings, "ADS_REWARDS_PER_DAY", 3)
    db = _FakeDB()
    await ads.grant_rewarded(_user(), db)
    assert db.locked == 1  # serializes concurrent grants against the cap
