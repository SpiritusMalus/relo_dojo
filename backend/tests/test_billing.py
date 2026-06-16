"""Web-checkout billing (app.services.billing / yookassa / crypto_pay) — pure layer.

Covers the catalog, the subscription expiry/stacking math, the effective-premium property, and both
adapters' request building + webhook verification. The DB claim/grant (apply_payment) is IO
(pragma: no cover) — verified on real Postgres via the smoke script, like the rest of the data layer.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.db.models import User
from app.services import billing, crypto_pay, yookassa


# ── catalog ────────────────────────────────────────────────────────────────────
def test_plans_catalog_is_consistent():
    assert billing.PLANS, "catalog must not be empty"
    for plan_id, plan in billing.PLANS.items():
        assert plan.id == plan_id, "plan.id must equal its catalog key (it's the stable wire id)"
        assert plan.days > 0
        assert plan.price_rub > 0 and plan.price_usd > 0
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


# ── crypto adapter (signing + order-id codec) ────────────────────────────────────
def test_crypto_sign_is_deterministic_and_verifies_round_trip():
    key = "test-api-key"
    payload = {"order_id": "o1", "status": "paid", "amount": "8"}
    sign = crypto_pay.make_sign(payload, key)
    assert sign == crypto_pay.make_sign(payload, key), "sign must be deterministic"
    assert crypto_pay.verify_webhook({**payload, "sign": sign}, key) is True


def test_crypto_verify_rejects_tampered_and_unsigned():
    key = "test-api-key"
    payload = {"order_id": "o1", "status": "paid"}
    sign = crypto_pay.make_sign(payload, key)
    # tampered amount → recomputed sign differs
    assert crypto_pay.verify_webhook({"order_id": "o1", "status": "paid_over", "sign": sign}, key) is False
    # wrong key → reject
    assert crypto_pay.verify_webhook({**payload, "sign": sign}, "other-key") is False
    # missing sign → reject
    assert crypto_pay.verify_webhook(payload, key) is False


def test_crypto_order_id_round_trips_user_and_plan():
    uid = str(uuid.uuid4())
    order_id = crypto_pay.make_order_id(uuid.UUID(uid), "black_belt_12m")
    assert crypto_pay.parse_order_id(order_id) == (uid, "black_belt_12m")
    # the nonce keeps order ids unique across attempts
    assert crypto_pay.make_order_id(uuid.UUID(uid), "black_belt_12m") != order_id


def test_crypto_parse_order_id_rejects_malformed():
    assert crypto_pay.parse_order_id("garbage") == (None, None)
    assert crypto_pay.parse_order_id("") == (None, None)


def test_crypto_invoice_request_shape():
    uid = uuid.uuid4()
    plan = billing.PLANS["black_belt_12m"]
    body = crypto_pay.build_invoice_request(plan, uid, "https://relodojo.app/done", "https://api/cb")
    assert body["amount"] == str(plan.price_usd)
    assert body["currency"] == "USD"
    assert body["url_callback"] == "https://api/cb"
    u, p = crypto_pay.parse_order_id(body["order_id"])
    assert (u, p) == (str(uid), plan.id)
    assert crypto_pay.invoice_url({"url": "https://pay.crypto/x"}) == "https://pay.crypto/x"


def test_paid_statuses_cover_exact_and_overpaid():
    assert "paid" in crypto_pay.PAID_STATUSES and "paid_over" in crypto_pay.PAID_STATUSES
    assert "pending" not in crypto_pay.PAID_STATUSES
