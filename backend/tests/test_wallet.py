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

    def __init__(self, rowcount: int = 1, scalar: int | None = None, snapshot=None) -> None:
        self.rowcount = rowcount
        self.scalar = scalar
        self.snapshot = snapshot  # what db.get(Progress, ...) returns (None = no synced snapshot)
        self.commits = 0
        self.rollbacks = 0
        self.refreshed = False

    async def execute(self, stmt):  # noqa: ANN001 — SQLAlchemy statement
        self.last_stmt = stmt
        return _FakeResult(self.rowcount, self.scalar)

    async def get(self, model, ident):  # noqa: ANN001 — db.get(Progress, user.id)
        return self.snapshot

    def last_params(self) -> dict:
        """Compiled bind params of the last statement (e.g. the koku amount debited)."""
        return dict(self.last_stmt.compile().params)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1

    async def refresh(self, obj, **kw) -> None:  # noqa: ANN001 — row-lock no-op in tests
        self.refreshed = True


def _user() -> SimpleNamespace:
    # last_win_day = today so the base-award tests aren't perturbed by the first-win bonus.
    from app.services.gating import _utc_day

    return SimpleNamespace(
        id=uuid.uuid4(), coins=0, freezes=0, is_premium=False, starter_day="", starter_used=0,
        last_win_day=_utc_day(), correct_run=0,
    )


async def test_award_anonymous_is_zero():
    db = _FakeDB()
    earned, balance, bonus, combo = await wallet.award_correct_check(None, db)
    assert (earned, balance, bonus, combo) == (0, None, 0, 0)
    assert db.commits == 0  # nothing written for anonymous callers


async def test_award_doubles_for_premium():
    db = _FakeDB(scalar=4)
    u = _user()
    u.is_premium = True
    earned, _, _, _ = await wallet.award_correct_check(u, db)
    assert earned == settings.COIN_REWARD_CORRECT * 2  # Black Belt perk (run 1 → no combo)


async def test_award_credits_and_returns_new_balance():
    db = _FakeDB(scalar=42)
    earned, balance, bonus, combo = await wallet.award_correct_check(_user(), db)
    assert earned == settings.COIN_REWARD_CORRECT
    assert bonus == 0 and combo == 0  # already won today; run 1 → no combo
    assert balance == 42  # the post-update balance comes from the DB, not the stale ORM object
    assert db.commits == 1


async def test_award_credits_once_for_a_new_token():
    db = _FakeDB(rowcount=1, scalar=12)  # jti insert succeeds; UPDATE returns new balance 12
    earned, balance, _, _ = await wallet.award_correct_check(_user(), db, jti="newhash")
    assert earned == settings.COIN_REWARD_CORRECT
    assert balance == 12
    assert db.commits == 1


async def test_award_is_idempotent_on_token_replay():
    db = _FakeDB(rowcount=0, scalar=7)  # jti already present (PK conflict) → already rewarded
    earned, balance, bonus, combo = await wallet.award_correct_check(_user(), db, jti="seenhash")
    assert earned == 0  # replay credits nothing
    assert bonus == 0 and combo == 0
    assert balance == 7  # but reports the current balance
    assert db.commits == 0  # no write


async def test_first_win_of_day_adds_bonus_once_and_stamps_day():
    from app.services.gating import _utc_day

    db = _FakeDB(scalar=99)
    u = _user()
    u.last_win_day = ""  # hasn't won today yet
    earned, _, bonus, _ = await wallet.award_correct_check(u, db)
    assert bonus == settings.FIRST_WIN_BONUS
    assert earned == settings.COIN_REWARD_CORRECT + settings.FIRST_WIN_BONUS
    assert u.last_win_day == _utc_day()  # stamped → won't fire again today


def test_combo_bonus_for_diminishes_by_tier():
    e = settings.COMBO_EVERY
    assert wallet.combo_bonus_for(1) == 0  # only on multiples of COMBO_EVERY
    assert wallet.combo_bonus_for(e) == settings.COMBO_BONUS_BASE
    assert wallet.combo_bonus_for(2 * e) == settings.COMBO_BONUS_BASE - settings.COMBO_BONUS_STEP
    assert wallet.combo_bonus_for(100 * e) == settings.COMBO_BONUS_MIN  # floored


async def test_award_adds_combo_at_milestone_and_advances_run():
    db = _FakeDB(scalar=50)
    u = _user()
    u.correct_run = settings.COMBO_EVERY - 1  # this correct answer hits the milestone
    earned, _, _, combo = await wallet.award_correct_check(u, db)
    assert combo == settings.COMBO_BONUS_BASE
    assert earned == settings.COIN_REWARD_CORRECT + settings.COMBO_BONUS_BASE
    assert u.correct_run == settings.COMBO_EVERY  # run advanced


async def test_reset_correct_run_clears_after_wrong():
    db = _FakeDB()
    u = _user()
    u.correct_run = 4
    await wallet.reset_correct_run(u, db)
    assert u.correct_run == 0
    assert db.commits == 1


async def test_reset_correct_run_noop_when_zero():
    db = _FakeDB()
    u = _user()  # correct_run = 0
    await wallet.reset_correct_run(u, db)
    assert db.commits == 0  # nothing to write


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


async def test_extra_pack_raises_today_headroom():
    from app.services.gating import _utc_day

    db = _FakeDB(rowcount=1)
    user = _user()
    await wallet.spend(user, db, "extra_pack", 1)
    assert user.starter_day == _utc_day()  # day normalized so the bonus isn't lost on first use
    assert user.starter_used == -settings.EXTRA_PACK_SIZE  # negative used = extra headroom
    assert db.commits == 1


async def test_promo_items_resolve():
    from app.services.gating import _utc_day

    db = _FakeDB(rowcount=1)
    user = _user()
    await wallet.spend(user, db, "omamori_promo", 1)  # half-price charm: just must not 400
    debited = [v for v in db.last_params().values() if isinstance(v, int)]
    assert settings.PRICE_OMAMORI_PROMO in debited

    db2 = _FakeDB(rowcount=1)
    u2 = _user()
    await wallet.spend(u2, db2, "extra_pack_promo", 1)  # double pack, regular price
    assert u2.starter_day == _utc_day()
    assert u2.starter_used == -settings.EXTRA_PACK_SIZE * 2


async def test_extra_pack_insufficient_koku_is_409():
    db = _FakeDB(rowcount=0)
    user = _user()
    with pytest.raises(Exception) as exc:
        await wallet.spend(user, db, "extra_pack", 1)
    assert getattr(exc.value, "status_code", None) == 409
    assert user.starter_used == 0  # quota untouched when the debit fails


async def test_streak_repair_charges_price_scaled_by_lost_streak():
    db = _FakeDB(rowcount=1)  # no synced snapshot → price scales with the (fallback) qty
    await wallet.spend(_user(), db, "streak_repair", 30)  # qty = lost streak length
    assert db.commits == 1
    debited = [v for v in db.last_params().values() if isinstance(v, int)]
    assert settings.REPAIR_BASE + settings.REPAIR_PER_DAY * 30 in debited


async def test_streak_repair_prices_off_server_snapshot_not_client_qty():
    # The server reads the real lost streak (30) from its own synced snapshot; an understated
    # qty=1 must NOT lower the price — the charge scales with the server's record (anti-spoof).
    snap = SimpleNamespace(data={"brokenStreak": {"streak": 30}})
    db = _FakeDB(rowcount=1, snapshot=snap)
    await wallet.spend(_user(), db, "streak_repair", 1)  # client claims it lost only 1 day
    debited = [v for v in db.last_params().values() if isinstance(v, int)]
    assert settings.REPAIR_BASE + settings.REPAIR_PER_DAY * 30 in debited
    assert settings.REPAIR_BASE + settings.REPAIR_PER_DAY * 1 not in debited


async def test_streak_repair_price_caps_at_max():
    db = _FakeDB(rowcount=1)
    await wallet.spend(_user(), db, "streak_repair", 400)  # absurdly long streak
    debited = [v for v in db.last_params().values() if isinstance(v, int)]
    assert settings.REPAIR_MAX in debited


async def test_use_freeze_without_charms_is_409():
    db = _FakeDB(rowcount=0)
    with pytest.raises(Exception) as exc:
        await wallet.spend(_user(), db, "use_freeze", 1)
    assert getattr(exc.value, "status_code", None) == 409
