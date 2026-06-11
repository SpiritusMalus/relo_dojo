"""Scroll rewards (app.services.rewards) — deterministic rolls, daily cap, crediting."""

import uuid
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import rewards


class _FakeDB:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj) -> None:  # noqa: ANN001
        pass


class _FixedRng:
    """Returns a fixed fraction of the total weight — lands on a chosen table row."""

    def __init__(self, fraction: float) -> None:
        self.fraction = fraction

    def random(self) -> float:
        return self.fraction


def _user(scroll_day: str = "", scrolls_used: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(), coins=0, freezes=0, scroll_day=scroll_day, scrolls_used=scrolls_used
    )


def test_roll_table_weights_cover_all_kinds():
    total = sum(w for _, _, w in rewards.SCROLL_TABLE)
    # First row at fraction 0; last row just under 1.
    assert rewards.roll_scroll(_FixedRng(0.0)) == (rewards.SCROLL_TABLE[0][0], rewards.SCROLL_TABLE[0][1])
    assert rewards.roll_scroll(_FixedRng(0.999)) == (rewards.SCROLL_TABLE[-1][0], rewards.SCROLL_TABLE[-1][1])
    # Koku rows dominate the table — the rares stay rare.
    koku_weight = sum(w for k, _, w in rewards.SCROLL_TABLE if k == "koku")
    assert koku_weight / total > 0.85


async def test_grant_scroll_credits_koku():
    db = _FakeDB()
    u = _user()
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))  # lands on the first koku row
    assert out["kind"] == "koku"
    assert u.coins == out["amount"] > 0
    assert u.scrolls_used == 1
    assert db.commits == 1


async def test_grant_scroll_credits_omamori():
    # Fraction aimed at the omamori row: cumulative weights 50,80,92,97,100 → 0.93 of total.
    db = _FakeDB()
    u = _user()
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.93))
    assert out["kind"] == "omamori"
    assert u.freezes == 1
    assert u.coins == 0


async def test_grant_scroll_kensei_credits_nothing_serverside():
    db = _FakeDB()
    u = _user()
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.98))
    assert out["kind"] == "kensei"
    assert (u.coins, u.freezes) == (0, 0)  # the boost is a client-side XP timer


async def test_daily_cap_blocks_with_code(monkeypatch):
    monkeypatch.setattr(settings, "SCROLLS_PER_DAY", 2)
    db = _FakeDB()
    u = _user()
    await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))
    await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))
    with pytest.raises(Exception) as exc:
        await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))
    assert getattr(exc.value, "status_code", None) == 403
    assert exc.value.detail.get("code") == "scroll_limit"


async def test_premium_doubles_the_daily_cap(monkeypatch):
    monkeypatch.setattr(settings, "SCROLLS_PER_DAY", 1)
    db = _FakeDB()
    u = _user()
    u.is_premium = True
    await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))  # 2nd is fine for Black Belt
    assert out["kind"] == "koku"
    with pytest.raises(Exception):
        await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))  # 3rd hits the doubled cap


async def test_premium_doubles_koku_amounts_but_not_rares():
    db = _FakeDB()
    u = _user()
    u.is_premium = True
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))  # first koku row
    assert out["kind"] == "koku"
    assert out["amount"] == rewards.SCROLL_TABLE[0][1] * 2
    assert u.coins == out["amount"]
    # Rares are NOT doubled — an omamori stays a single charm.
    out2 = await rewards.grant_scroll(u, db, rng=_FixedRng(0.93))
    assert out2["kind"] == "omamori"
    assert out2["amount"] == 1
    assert u.freezes == 1


async def test_cap_resets_on_new_day(monkeypatch):
    monkeypatch.setattr(settings, "SCROLLS_PER_DAY", 1)
    db = _FakeDB()
    u = _user(scroll_day="2000-01-01", scrolls_used=99)
    out = await rewards.grant_scroll(u, db, rng=_FixedRng(0.0))
    assert out["kind"] == "koku"
    assert u.scrolls_used == 1
