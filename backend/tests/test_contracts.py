"""Daily contracts pure layer (app.services.contracts) — deterministic pick + claim math. No DB."""

from app.services import contracts


def test_daily_pick_is_deterministic_and_sized():
    a = contracts.daily_contract_ids("user-1", "2026-06-13")
    b = contracts.daily_contract_ids("user-1", "2026-06-13")
    assert a == b  # stable within a (user, day)
    assert len(a) == contracts.DAILY_COUNT
    assert all(cid in {t["id"] for t in contracts.TEMPLATES} for cid in a)


def test_daily_pick_varies_by_day_and_user():
    base = contracts.daily_contract_ids("user-1", "2026-06-13")
    # Different day or user generally reshuffles — at least one of these should differ.
    other_day = contracts.daily_contract_ids("user-1", "2026-06-20")
    other_user = contracts.daily_contract_ids("user-2", "2026-06-13")
    assert base != other_day or base != other_user


def test_pick_is_in_canonical_order():
    ids = contracts.daily_contract_ids("user-1", "2026-06-13")
    canonical = [t["id"] for t in contracts.TEMPLATES]
    assert ids == [c for c in canonical if c in set(ids)]


def test_build_today_reports_progress_done_claimed():
    subj, day = "user-1", "2026-06-13"
    ids = contracts.daily_contract_ids(subj, day)
    # Give a generous count bag so any selected contract is at/over target.
    counts = {"answered": 100, "answered_correct": 100, "sessions": 5, "reviews": 5}
    built = contracts.build_today(subj, day, counts, claimed={ids[0]})
    assert [c["id"] for c in built] == ids
    assert all(c["done"] for c in built)
    assert built[0]["claimed"] is True
    assert built[0]["progress"] <= built[0]["target"]  # progress is clamped


def test_is_claimable_requires_today_target_and_not_claimed():
    subj, day = "user-1", "2026-06-13"
    cid = contracts.daily_contract_ids(subj, day)[0]
    tpl = next(t for t in contracts.TEMPLATES if t["id"] == cid)
    met = {tpl["metric"]: tpl["target"]}
    short = {tpl["metric"]: tpl["target"] - 1}
    assert contracts.is_claimable(subj, day, cid, met, claimed=set()) is True
    assert contracts.is_claimable(subj, day, cid, short, claimed=set()) is False  # target not met
    assert contracts.is_claimable(subj, day, cid, met, claimed={cid}) is False  # already claimed


def test_is_claimable_rejects_contract_not_offered_today():
    subj, day = "user-1", "2026-06-13"
    today = set(contracts.daily_contract_ids(subj, day))
    not_today = next(t["id"] for t in contracts.TEMPLATES if t["id"] not in today)
    counts = {t["metric"]: 999 for t in contracts.TEMPLATES}
    assert contracts.is_claimable(subj, day, not_today, counts, claimed=set()) is False


def test_reward_for():
    assert contracts.reward_for("warmup") == 15
    assert contracts.reward_for("ghost") == 0
