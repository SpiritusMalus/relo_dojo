"""Email sign-up policy. Gmail (and its googlemail.com alias) is blocked per the RU restriction.

Enforced server-side so the client check can't be bypassed. Dots / "+tag" don't change the domain,
so a plain domain match is enough; Google Workspace custom domains are indistinguishable from any
other domain and are intentionally not blocked.
"""

from __future__ import annotations

BLOCKED_EMAIL_DOMAINS = frozenset({"gmail.com", "googlemail.com"})

# User-facing message (mirrors the localized client banner; shown if a request reaches the API anyway).
BLOCKED_EMAIL_MESSAGE = "Sorry, Gmail isn't allowed for sign-up in Russia."


def is_blocked_email(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return domain in BLOCKED_EMAIL_DOMAINS
