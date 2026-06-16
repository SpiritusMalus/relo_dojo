#!/usr/bin/env python3
"""Lifecycle re-engagement emails — the Day-2 / Day-6 "come back to the mat" batch job.

D7 retention (the north star) is won by pulling a learner back on the days between sign-up and day 7.
We have no device push yet, but we do have SMTP (the activation email), so this is the cheapest lever
available: once a day, mail the learners who have gone quiet for ~2 and ~6 days a short Sensei-voice
nudge. Decision logic + idempotency live in app.services.lifecycle_email; this script is the thin
orchestration cron runs.

Idempotent and safe to run repeatedly: each (user, kind) is CLAIMED in the sent_emails guard table
before the message goes out, so a re-run or an overlapping run never double-mails. OFF by default
(settings.RETURN_EMAILS_ENABLED) so deploying the code can't surprise real users.

Usage:
    cd backend
    python scripts/send_return_emails.py --dry-run     # list who WOULD be mailed; sends nothing
    python scripts/send_return_emails.py               # send (requires RETURN_EMAILS_ENABLED=true)
    python scripts/send_return_emails.py --force        # send even if the feature flag is off

Cron (daily, e.g. 09:00 in the users' timezone):
    0 9 * * *  cd /srv/grammar-dojo/backend && /srv/venv/bin/python scripts/send_return_emails.py

Exit code is non-zero only on an unexpected error, so it slots into a scheduler/alerting cleanly.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone

# Allow running as `python scripts/send_return_emails.py` from backend/ (add the package root).
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.services import lifecycle_email as le  # noqa: E402
from app.services.email import send_email  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("grammar_dojo.return_emails")


async def run(dry_run: bool, force: bool) -> int:
    if not settings.RETURN_EMAILS_ENABLED and not force and not dry_run:
        log.info("RETURN_EMAILS_ENABLED is false — nothing to do (use --force to override, "
                 "--dry-run to preview).")
        return 0

    now = datetime.now(timezone.utc)
    link = le.cta_url()
    if not link and not dry_run:
        log.warning("No RETURN_EMAIL_CTA_URL / APP_BASE_URL set — the email CTA link will be empty.")

    async with SessionLocal() as db:
        recipients = await le.select_due_recipients(db, now)
        log.info("%d learner(s) due a return email.", len(recipients))

        sent = skipped = 0
        for user, kind in recipients:
            if dry_run:
                log.info("[dry-run] would send %-11s to %s", kind, user.email)
                continue
            claimed = await le.claim_send(db, user.id, kind)
            if not claimed:  # someone/something already sent this kind — don't double-mail
                skipped += 1
                continue
            subject, text, html = le.build_return_email(kind, link)
            await send_email(user.email, subject, text, html)
            await db.commit()  # persist the claim per-send so a mid-batch crash can't replay it
            sent += 1
            log.info("sent %-11s to %s", kind, user.email)

        if dry_run:
            log.info("dry-run complete — %d would be mailed.", len(recipients))
        else:
            log.info("done — %d sent, %d already-claimed skipped.", sent, skipped)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Send Day-2 / Day-6 re-engagement emails.")
    ap.add_argument("--dry-run", action="store_true", help="list who would be mailed; send nothing")
    ap.add_argument("--force", action="store_true", help="send even if RETURN_EMAILS_ENABLED is off")
    args = ap.parse_args()
    try:
        sys.exit(asyncio.run(run(args.dry_run, args.force)))
    except Exception:  # noqa: BLE001 — surface a non-zero exit for the scheduler
        log.exception("return-email job failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
