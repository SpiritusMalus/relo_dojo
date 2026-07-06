"""YooKassa adapter — create a payment + verify its webhook (RU cards + SBP via an ИП account).

Pure helpers (request body, object parsing, confirmation-url extraction) are unit-tested; the two
HTTP calls are thin and pragma: no cover, mirroring services/ollama_client.py.

Trust model: YooKassa webhook notifications carry NO shared signature, so we do NOT trust the POST
body. We take only the payment id from it, RE-FETCH the payment from the API, and read its
authoritative `status` + `metadata` (YooKassa's documented secure pattern). API auth is HTTP Basic
shopId:secret over TLS.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

import httpx

from ..core.config import settings
from .billing import Plan


class BillingError(Exception):
    """User-actionable billing/provider problem (provider unreachable or rejecting)."""


def build_payment_request(plan: Plan, user_id: uuid.UUID, return_url: str) -> dict[str, Any]:
    """The YooKassa POST /payments body for a one-off plan purchase. Amount is RUB with 2 decimals;
    `metadata` carries who/what so the webhook can grant from server-trusted data, never client
    input. `capture: true` = charge immediately (no two-phase hold). Pure."""
    return {
        "amount": {"value": f"{plan.price_rub}.00", "currency": "RUB"},
        "capture": True,
        "confirmation": {"type": "redirect", "return_url": return_url},
        "description": plan.label_ru,
        "metadata": {"user_id": str(user_id), "plan": plan.id},
    }


def parse_payment(obj: dict[str, Any]) -> tuple[str, str, Optional[str], Optional[str]]:
    """(payment_id, status, user_id, plan) from a YooKassa payment object. Pure. `status` is
    'succeeded' for a captured payment; user_id/plan come from the metadata we set at create time."""
    meta = obj.get("metadata") or {}
    return (
        str(obj.get("id", "")),
        str(obj.get("status", "")),
        meta.get("user_id"),
        meta.get("plan"),
    )


def payment_amount(obj: dict[str, Any]) -> tuple[str, str]:
    """(value, currency) from a YooKassa payment object, e.g. ('690.00', 'RUB'). Pure. The webhook
    re-verifies this against the plan price before granting (billing.amount_matches)."""
    amt = obj.get("amount") or {}
    return (str(amt.get("value", "")), str(amt.get("currency", "")))


def confirmation_url(payment: dict[str, Any]) -> str:
    """The hosted-checkout URL the buyer must be redirected to (from a created payment). Pure."""
    return str((payment.get("confirmation") or {}).get("confirmation_url", ""))


def notification_payment_id(body: dict[str, Any]) -> str:
    """The payment id out of a webhook notification body ({event, object:{id,...}}). Pure. We use
    ONLY this id, then re-fetch the payment to verify it — the body itself is untrusted."""
    return str((body.get("object") or {}).get("id", ""))


def _auth() -> tuple[str, str]:
    return (settings.YOOKASSA_SHOP_ID, settings.YOOKASSA_SECRET_KEY)


async def create_payment(  # pragma: no cover — HTTP IO
    plan: Plan, user_id: uuid.UUID, return_url: str
) -> dict[str, Any]:
    """Create a redirect payment; returns the YooKassa payment object (incl. confirmation url)."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{settings.YOOKASSA_API_URL}/payments",
                json=build_payment_request(plan, user_id, return_url),
                auth=_auth(),
                headers={"Idempotence-Key": str(uuid.uuid4())},  # required per create
            )
    except httpx.HTTPError as exc:
        raise BillingError("Could not reach YooKassa.") from exc
    if resp.status_code >= 400:
        raise BillingError(f"YooKassa rejected the payment ({resp.status_code}).")
    return resp.json()


async def fetch_payment(payment_id: str) -> dict[str, Any]:  # pragma: no cover — HTTP IO
    """Re-fetch a payment to authoritatively verify a webhook (never trust the POST body)."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{settings.YOOKASSA_API_URL}/payments/{payment_id}", auth=_auth()
            )
    except httpx.HTTPError as exc:
        raise BillingError("Could not reach YooKassa.") from exc
    if resp.status_code >= 400:
        raise BillingError(f"YooKassa payment lookup failed ({resp.status_code}).")
    return resp.json()
