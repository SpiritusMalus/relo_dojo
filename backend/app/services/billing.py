"""Web-checkout billing — paid premium ("Black Belt"), provider-neutral core.

Apple/Google forbid third-party payment for in-app digital goods, so premium is sold on the web
(relodojo.app) and the account unlocks server-side via the provider webhook. This module is the
provider-AGNOSTIC core; the rail lives in a sibling adapter (services/yookassa.py for RU cards/SBP).
The adapter authenticates its webhook, then hands a
(provider, external_id, user_id, plan) tuple to `apply_payment`.

Design mirrors the rest of the backend:
- PLANS is catalog data (id -> duration + price + labels), like cosmetics.py / content.py.
- The DECISIONS are pure and unit-tested: `get_plan`, `grant_premium` (expiry math).
- The only IO is the idempotent claim + grant (`claim_payment` / `apply_payment`), pragma: no cover
  like the rest of the data layer — payment webhooks are at-least-once, so the grant MUST be
  replay-safe (the (provider, external_id) PK guarantees once-only, same as AwardedToken/SentEmail).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import NamedTuple, Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..db.models import ProcessedPayment, User

PROVIDER_YOOKASSA = "yookassa"


class Plan(NamedTuple):
    id: str
    days: int
    price_rub: int  # charged via YooKassa (whole rubles)
    label_en: str
    label_ru: str


# Product catalog. Annual is the anchor (cheapest per month), matching the pricing thesis
# (RU prices undercut Praktika). Ids are STABLE — they're embedded in the payment metadata and read
# back at webhook time, so renaming one orphans in-flight pays.
PLANS: dict[str, Plan] = {
    "black_belt_1m": Plan("black_belt_1m", 30, 690, "Black Belt · 1 month", "Чёрный пояс · 1 месяц"),
    "black_belt_3m": Plan("black_belt_3m", 90, 1790, "Black Belt · 3 months", "Чёрный пояс · 3 месяца"),
    "black_belt_12m": Plan("black_belt_12m", 365, 4900, "Black Belt · 12 months", "Чёрный пояс · 12 месяцев"),
}


def get_plan(plan_id: str) -> Optional[Plan]:
    """The plan for an id, or None for an unknown/typo id (caller 404s/ignores)."""
    return PLANS.get(plan_id)


def amount_matches(plan: Plan, value: str, currency: str) -> bool:
    """True iff a captured payment's amount matches the plan's price (whole RUB). Defence-in-depth
    for the webhook: even though we set the amount server-side at checkout, we re-verify the actually
    captured `value`/`currency` before granting, so a payment carrying a plan in its metadata can
    never grant that plan for a mismatched or short capture. Pure — exact Decimal compare."""
    if currency != "RUB":
        return False
    try:
        paid = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return False
    return paid == Decimal(plan.price_rub)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def grant_premium(user: User, days: int, now: Optional[datetime] = None) -> datetime:
    """Extend the user's paid subscription by `days`. Stacks on any remaining time (renew early
    without losing days); starts from `now` if the user is lapsed or new. Returns the new expiry.
    Pure except the single mutation — unit-tested with a fake user."""
    now = now or _now()
    base = user.premium_until
    if base is None or base < now:
        base = now
    user.premium_until = base + timedelta(days=days)
    return user.premium_until


async def claim_payment(  # pragma: no cover — DB IO, verified on real PG (smoke/manual)
    db, provider: str, external_id: str, user_id: uuid.UUID, plan_id: str, days: int
) -> bool:
    """Atomically claim a provider payment id. True if THIS call won the claim (caller then grants),
    False if the payment was already processed. INSERT ... ON CONFLICT DO NOTHING on the
    (provider, external_id) PK, so an at-least-once / retried webhook can never double-grant."""
    res = await db.execute(
        pg_insert(ProcessedPayment)
        .values(provider=provider, external_id=external_id, user_id=user_id, plan=plan_id, days=days)
        .on_conflict_do_nothing(index_elements=["provider", "external_id"])
    )
    return res.rowcount > 0


async def apply_payment(  # pragma: no cover — DB IO orchestration
    db, provider: str, external_id: str, user_id: uuid.UUID, plan_id: str
) -> bool:
    """Idempotently grant premium for an already-AUTHENTICATED successful payment. Returns True if
    premium was granted by THIS call; False on a replay (already processed) or an unknown plan/user.
    The webhook handler is responsible for verifying the notification BEFORE calling this."""
    plan = get_plan(plan_id)
    if plan is None:
        return False
    if not await claim_payment(db, provider, external_id, user_id, plan_id, plan.days):
        return False  # already processed — replay-safe
    user = await db.get(User, user_id)
    if user is None:
        await db.commit()  # keep the claim row for audit; nothing to grant
        return False
    grant_premium(user, plan.days)
    await db.commit()
    return True
