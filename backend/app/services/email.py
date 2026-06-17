"""Transactional email — account verification.

Uses the stdlib SMTP client (no extra dependency) run in a worker thread so it doesn't block the
event loop. If SMTP isn't configured (SMTP_HOST empty), sending is a no-op that logs the link — so
local dev works without a mail server: copy the logged URL to activate.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from ..core.config import settings

logger = logging.getLogger("relo_dojo.email")


def _build_message(to: str, link: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Activate your Relo Dojo account"
    msg["From"] = formataddr((settings.EMAIL_FROM_NAME, settings.EMAIL_FROM))
    msg["To"] = to
    msg.set_content(
        "Welcome to Relo Dojo!\n\n"
        "Confirm your email to unlock all lessons:\n"
        f"{link}\n\n"
        f"The link is valid for {settings.VERIFY_TOKEN_EXPIRE_H} hours. "
        "If you didn't create an account, you can ignore this message."
    )
    msg.add_alternative(
        f"""\
<div style="font-family:system-ui,Arial,sans-serif;max-width:480px">
  <h2 style="margin:0 0 12px">Welcome to Relo Dojo</h2>
  <p>Confirm your email to unlock all lessons.</p>
  <p><a href="{link}"
        style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;
               padding:12px 20px;border-radius:10px;font-weight:600">Activate account</a></p>
  <p style="color:#666;font-size:13px">The link is valid for {settings.VERIFY_TOKEN_EXPIRE_H} hours.
     If you didn't create an account, ignore this message.</p>
</div>""",
        subtype="html",
    )
    return msg


def _send_sync(msg: EmailMessage) -> None:
    if settings.SMTP_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            s.starttls()
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)


async def send_verification_email(to: str, link: str) -> None:
    """Send the activation link. No-op (logs the link) when SMTP isn't configured."""
    if not settings.SMTP_HOST:
        logger.warning("SMTP not configured — verification link for %s: %s", to, link)
        return
    msg = _build_message(to, link)
    try:
        await asyncio.to_thread(_send_sync, msg)
    except Exception:  # don't fail registration if the mail server hiccups
        logger.exception("Failed to send verification email to %s; link: %s", to, link)


async def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """Generic transactional send (plain text + optional HTML alternative).

    Shares the verification path's behavior: when SMTP isn't configured it's a no-op that LOGS the
    message instead of erroring, so dev/CI work without a mail server. Returns True if the message
    was handed to SMTP, False if it was only logged (unconfigured) or the server hiccuped — callers
    use this for telemetry but should not treat a False as fatal. Used by the lifecycle
    re-engagement job (services.lifecycle_email)."""
    if not settings.SMTP_HOST:
        logger.warning("SMTP not configured — '%s' email to %s not sent (logged only)", subject, to)
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.EMAIL_FROM_NAME, settings.EMAIL_FROM))
    msg["To"] = to
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        await asyncio.to_thread(_send_sync, msg)
        return True
    except Exception:  # a re-engagement email is best-effort — never crash the batch job
        logger.exception("Failed to send '%s' email to %s", subject, to)
        return False
