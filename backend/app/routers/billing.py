"""Web-checkout billing endpoints (premium "Black Belt": YooKassa for RU cards/SBP).

Sold on the web because Apple/Google forbid third-party payment for in-app digital goods. The whole
router 404s unless settings.BILLING_ENABLED is on (like /dev/premium, /events/retention) — so
deploying the code is inert until a provider is configured.

- GET  /billing/plans              -> the plan catalog (public; the web page renders prices)
- POST /billing/checkout           -> (auth) start a purchase, returns the provider's checkout URL
- POST /billing/yookassa/webhook   -> grant on a verified succeeded payment (re-fetched, untrusted body)

The webhook is PUBLIC (the provider can't carry a user token); it authenticates the notification
itself (YooKassa: re-fetch the payment) and the buyer/plan come from server-trusted data (YooKassa
metadata), never raw client input.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import BillingPlanOut, CheckoutIn, CheckoutOut, PlansOut
from ..services import billing, yookassa
from ..services.yookassa import BillingError

router = APIRouter(prefix="/billing", tags=["billing"])


def _require_enabled() -> None:
    """Keep the whole billing surface invisible until a provider is wired and the flag is flipped."""
    if not settings.BILLING_ENABLED:
        raise HTTPException(status_code=404, detail="Not found.")


def _as_uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


@router.get("/plans", response_model=PlansOut)
async def plans() -> PlansOut:
    """The Black Belt plan catalog (durations + RUB/USD prices) for the web checkout to render."""
    _require_enabled()
    return PlansOut(plans=[BillingPlanOut(**p._asdict()) for p in billing.PLANS.values()])


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(
    payload: CheckoutIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CheckoutOut:
    """Start a purchase for the AUTHENTICATED buyer; returns the provider's hosted checkout URL. The
    buyer is always the caller — you can only ever top up your own account."""
    _require_enabled()
    plan = billing.get_plan(payload.plan)
    if plan is None:
        raise HTTPException(status_code=404, detail="Unknown plan.")
    return_url = settings.billing_return_url
    try:
        # YooKassa is the only rail (method is validated by the schema pattern).
        payment = await yookassa.create_payment(plan, user.id, return_url)
        url = yookassa.confirmation_url(payment)
    except BillingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not url:
        raise HTTPException(status_code=502, detail="Payment provider did not return a checkout URL.")
    return CheckoutOut(url=url)


@router.post("/yookassa/webhook")
async def yookassa_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    """YooKassa notification. We trust only the payment id in the body, then RE-FETCH the payment to
    read its authoritative status + metadata before granting. Always 200 (even when ignoring) so the
    provider doesn't retry a notification we've deliberately dropped."""
    _require_enabled()
    body = await request.json()
    payment_id = yookassa.notification_payment_id(body)
    if not payment_id:
        return {"ok": True}
    try:
        payment = await yookassa.fetch_payment(payment_id)
    except BillingError:
        raise HTTPException(status_code=502, detail="Could not verify the payment.")
    pid, pay_status, user_id, plan = yookassa.parse_payment(payment)
    uid = _as_uuid(user_id)
    if pay_status == "succeeded" and uid is not None and plan:
        await billing.apply_payment(db, billing.PROVIDER_YOOKASSA, pid, uid, plan)
    return {"ok": True}
