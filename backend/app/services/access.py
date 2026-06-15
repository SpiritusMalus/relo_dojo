"""Central feature-access registry — the single source of truth for who can use what.

Design goal: gating is *data*, not scattered `if` checks. Add a feature to ``FEATURES`` once and
both the API guard (``require``) and the client-facing capability map (``access_map`` in
``/auth/me``) read from the same table. No per-endpoint ad-hoc rules to keep in sync.

Gating axes (a feature may require any combination; an empty gate = open to everyone, anonymous
included — the Duolingo-style "generous free taste"):

- ``account``   a registered account (any bearer token). Used for cross-device progress sync.
- ``verified``  a confirmed email. Kept available, but NOT used to gate content by default
                (verification only affects the daily-exercise cap, see ``gating.py``).
- ``premium``   the "Black Belt" subscription. When the payment provider lands (Phase 7/8),
                moving a feature behind the paywall is a one-line change here — e.g. flip
                ``"challenge"`` to ``Gate(premium=True)`` — with zero screen/endpoint rewrites.

Per-item content ownership (premium story arcs unlocked with koku) is a *different* mechanism
(see ``content.py`` / ``/content``): that's per-row ownership, not a feature flag, so it stays out
of this registry on purpose.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status

from ..db.models import User


@dataclass(frozen=True)
class Gate:
    """Requirements for one feature. All default False = open to anonymous users."""

    account: bool = False
    verified: bool = False
    premium: bool = False


# The registry. Keep keys in sync with the mobile mirror in `mobile/store/access.ts`
# (a cross-language contract test asserts they match).
FEATURES: dict[str, Gate] = {
    # Cross-device progress sync is the one thing an anonymous device genuinely cannot do —
    # this is what the soft register wall sells ("save your progress").
    "sync": Gate(account=True),
    # All learning content is open to everyone (anonymous included), Duo-style.
    "story": Gate(),
    "challenge": Gate(),
    "review": Gate(),
    "review_text": Gate(),
    # Convenience / power-user perks — the actual paywall surface.
    "premium_unlimited": Gate(premium=True),  # no daily exercise cap
    "no_ads": Gate(premium=True),  # subscription removes interstitial ads (rewarded stays opt-in)
}


def can(feature: str, user: User | None) -> bool:
    """True if `user` (None = anonymous) may use `feature`. Unknown feature → open (fail-open is
    safe here: gating that matters is always declared; a typo shouldn't lock users out silently)."""
    gate = FEATURES.get(feature, Gate())
    if gate.account and user is None:
        return False
    if gate.verified and (user is None or not user.is_verified):
        return False
    if gate.premium and (user is None or not user.is_premium):
        return False
    return True


def access_map(user: User | None) -> dict[str, bool]:
    """The full capability map for a user, returned in /auth/me so the client never re-derives
    gating — it just reads booleans."""
    return {name: can(name, user) for name in FEATURES}


def require(feature: str, user: User | None) -> None:
    """Guard an endpoint with one call. 403 (structured) when the feature is gated for this user."""
    if not can(feature, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "locked", "feature": feature, "message": _MESSAGES.get(feature, _DEFAULT_MSG)},
        )


_DEFAULT_MSG = "This feature needs an account."
_MESSAGES: dict[str, str] = {
    "sync": "Create a free account to save and sync your progress across devices.",
    "premium_unlimited": "Black Belt unlocks unlimited practice.",
}
