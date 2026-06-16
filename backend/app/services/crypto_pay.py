"""Crypto adapter — create a USDT invoice + verify its webhook (fits relocants off RU banking).

Implemented against Cryptomus (popular for USDT in RU/CIS), but the surface is small enough to swap
for another gateway: the router only needs create_invoice + verify_webhook + the parse helpers.

Trust model: Cryptomus signs every request/webhook as md5( base64(json_body) + API_KEY ). Because
only we and Cryptomus know the API key, a webhook whose `sign` validates is trustworthy — so the
`order_id` we embedded at create time (which encodes the buyer + plan) can be read back safely.
The buyer + plan therefore come from server-trusted data, never raw client input.

Pure helpers (sign, verify, request body, order-id codec, status check) are unit-tested; the single
HTTP call is pragma: no cover, like services/ollama_client.py.

NOTE on serialization: the sign is computed over a compact JSON encoding. We use
json.dumps(..., separators=(",", ":")) with the default ensure_ascii=True, which matches PHP's
default json_encode (compact + \\uXXXX escaping). The one known divergence is PHP escaping '/' as
'\\/'; our signed payloads carry ids/amounts/statuses, not URLs, so this doesn't bite — re-confirm
on the first real webhook and adjust here if a gateway change introduces slashes.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from typing import Any, Optional

import httpx

from ..core.config import settings
from .billing import Plan
from .yookassa import BillingError  # shared provider-error type

# Cryptomus payment statuses that mean "money received" (grant premium on these).
PAID_STATUSES = frozenset({"paid", "paid_over"})


def make_sign(payload: dict[str, Any], api_key: str) -> str:
    """Cryptomus request/webhook signature: md5( base64(compact_json(payload)) + api_key ). Pure."""
    body = json.dumps(payload, separators=(",", ":"))
    encoded = base64.b64encode(body.encode()).decode()
    return hashlib.md5((encoded + api_key).encode()).hexdigest()


def verify_webhook(payload: dict[str, Any], api_key: str) -> bool:
    """True iff the webhook `sign` matches a signature computed over the rest of the body. Constant
    -time compare. Pure — the heart of trusting an inbound notification."""
    received = payload.get("sign")
    if not received:
        return False
    expected = make_sign({k: v for k, v in payload.items() if k != "sign"}, api_key)
    return hmac.compare_digest(expected, str(received))


def make_order_id(user_id: uuid.UUID, plan_id: str) -> str:
    """Encode buyer + plan into a unique order id (read back after the sign verifies). Pure."""
    return f"{user_id}:{plan_id}:{uuid.uuid4().hex[:12]}"


def parse_order_id(order_id: str) -> tuple[Optional[str], Optional[str]]:
    """(user_id, plan_id) from an order id we created, or (None, None) if malformed. Pure."""
    parts = order_id.split(":")
    if len(parts) >= 2 and parts[0] and parts[1]:
        return parts[0], parts[1]
    return None, None


def build_invoice_request(
    plan: Plan, user_id: uuid.UUID, return_url: str, callback_url: str
) -> dict[str, Any]:
    """The Cryptomus POST /payment body for a one-off plan purchase (USD ≈ USDT). Pure."""
    return {
        "amount": str(plan.price_usd),
        "currency": "USD",
        "order_id": make_order_id(user_id, plan.id),
        "url_return": return_url,
        "url_callback": callback_url,
        "lifetime": 3600,
    }


def invoice_url(result: dict[str, Any]) -> str:
    """The hosted-invoice URL to redirect the buyer to (from a created-invoice result). Pure."""
    return str(result.get("url", ""))


async def create_invoice(  # pragma: no cover — HTTP IO
    plan: Plan, user_id: uuid.UUID, return_url: str, callback_url: str
) -> dict[str, Any]:
    """Create a hosted crypto invoice; returns the Cryptomus `result` object (incl. its url)."""
    body = build_invoice_request(plan, user_id, return_url, callback_url)
    headers = {
        "merchant": settings.CRYPTO_MERCHANT_ID,
        "sign": make_sign(body, settings.CRYPTO_API_KEY),
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{settings.CRYPTO_API_URL}/payment", json=body, headers=headers
            )
    except httpx.HTTPError as exc:
        raise BillingError("Could not reach the crypto gateway.") from exc
    if resp.status_code >= 400:
        raise BillingError(f"Crypto gateway rejected the invoice ({resp.status_code}).")
    return resp.json().get("result") or {}
