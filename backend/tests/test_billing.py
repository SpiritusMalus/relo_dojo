"""Web-checkout billing (app.services.billing / yookassa) — pure layer.

Covers the catalog, the subscription expiry/stacking math, the effective-premium property, and the
YooKassa adapter's request building + payment parsing. The DB claim/grant (apply_payment) is IO
(pragma: no cover) — verified on real Postgres via the smoke script, like the rest of the data layer.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.db.models import User
from app.services import billing, yookassa


# ── catalog ────────────────────────────────────────────────────────────────────
def test_plans_catalog_is_consistent():
    assert billing.PLANS, "catalog must not be empty"
    for plan_id, plan in billing.PLANS.items():
        assert plan.id == plan_id, "plan.id must equal its catalog key (it's the stable wire id)"
        assert plan.days > 0
        assert plan.price_rub > 0
        assert plan.label_en and plan.label_ru


def test_get_plan_known_and_unknown():
    assert billing.get_plan("black_belt_1m") is billing.PLANS["black_belt_1m"]
    assert billing.get_plan("nope") is None


# ── grant_premium (expiry math) ──────────────────────────────────────────────────
def test_grant_from_lapsed_starts_at_now():
    now = datetime(2026, 6, 16, tzinfo=timezone.utc)
    u = SimpleNamespace(premium_until=None)
    new = billing.grant_premium(u, 30, now=now)
    assert new == now + timedelta(days=30)
    assert u.premium_until == new


def test_grant_from_expired_restarts_from_now_not_the_past():
    now = datetime(2026, 6, 16, tzinfo=timezone.utc)
    u = SimpleNamespace(premium_until=now - timedelta(days=10))  # already expired
    new = billing.grant_premium(u, 30, now=now)
    assert new == now + timedelta(days=30)


def test_grant_stacks_on_remaining_time_for_early_renewal():
    now = datetime(2026, 6, 16, tzinfo=timezone.utc)
    active = now + timedelta(days=5)  # still has 5 days left
    u = SimpleNamespace(premium_until=active)
    new = billing.grant_premium(u, 30, now=now)
    assert new == active + timedelta(days=30), "renewing early must not forfeit remaining days"


# ── is_premium property (effective entitlement) ──────────────────────────────────
def test_is_premium_true_when_comped_override():
    assert User(premium_override=True, premium_until=None).is_premium is True


def test_is_premium_true_while_paid_sub_live_false_once_expired():
    future = datetime.now(timezone.utc) + timedelta(days=1)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert User(premium_override=False, premium_until=future).is_premium is True
    assert User(premium_override=False, premium_until=past).is_premium is False


def test_is_premium_false_when_nothing_set():
    assert User(premium_override=False, premium_until=None).is_premium is False


# ── YooKassa adapter (pure helpers) ──────────────────────────────────────────────
def test_yookassa_payment_request_shape():
    uid = uuid.uuid4()
    plan = billing.PLANS["black_belt_1m"]
    body = yookassa.build_payment_request(plan, uid, "https://relodojo.app/done")
    assert body["amount"] == {"value": f"{plan.price_rub}.00", "currency": "RUB"}
    assert body["capture"] is True
    assert body["confirmation"] == {"type": "redirect", "return_url": "https://relodojo.app/done"}
    # metadata carries who/what so the webhook grants from server-trusted data, not client input.
    assert body["metadata"] == {"user_id": str(uid), "plan": plan.id}


def test_yookassa_parse_payment_and_urls():
    uid = str(uuid.uuid4())
    obj = {
        "id": "pay_123",
        "status": "succeeded",
        "metadata": {"user_id": uid, "plan": "black_belt_3m"},
        "confirmation": {"confirmation_url": "https://yoomoney/checkout/pay_123"},
    }
    assert yookassa.parse_payment(obj) == ("pay_123", "succeeded", uid, "black_belt_3m")
    assert yookassa.confirmation_url(obj) == "https://yoomoney/checkout/pay_123"
    assert yookassa.notification_payment_id({"event": "payment.succeeded", "object": {"id": "pay_123"}}) == "pay_123"


def test_yookassa_parse_payment_tolerates_missing_metadata():
    assert yookassa.parse_payment({"id": "p", "status": "pending"}) == ("p", "pending", None, None)
