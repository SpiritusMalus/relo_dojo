"""Email auth policy. Google-owned mail domains are blocked for BOTH sign-up and sign-in per the
RU restriction on authorizing users through foreign email services (the fines cover login as much
as registration, so pre-existing Gmail accounts are deliberately locked out too).

Enforced server-side so the client check can't be bypassed. Dots / "+tag" don't change the domain,
so a plain domain match is enough; Google Workspace custom domains are indistinguishable from any
other domain and are intentionally not blocked.
"""

from __future__ import annotations

# Consumer mail domains operated by Google: gmail.com and its googlemail.com alias, plus the
# google.com / googlegroups.com inboxes (corporate and groups mail — still Google-run addresses).
BLOCKED_EMAIL_DOMAINS = frozenset({"gmail.com", "googlemail.com", "google.com", "googlegroups.com"})

# User-facing message (mirrors the localized client banner; shown if a request reaches the API anyway).
BLOCKED_EMAIL_MESSAGE = "Sorry, Google email (Gmail) can't be used to sign in or sign up in Russia."


def is_blocked_email(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return domain in BLOCKED_EMAIL_DOMAINS
