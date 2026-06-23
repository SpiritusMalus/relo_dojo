#!/usr/bin/env python3
"""Trigger the YooKassa webhook locally — no public tunnel needed.

WHY this works without a tunnel: the backend does NOT trust the webhook POST body. It reads only the
payment id from it, then RE-FETCHES the payment from the YooKassa API (outbound TLS from your laptop)
to read the authoritative status + metadata before granting (see app/services/yookassa.py,
app/routers/billing.py). So we can POST the notification ourselves with a real payment id and the
backend still verifies it against YooKassa — exactly what the dashboard would have sent.

Use it after paying a test card in the local checkout: grab the payment id (from the backend
/billing/checkout response, the YooKassa test dashboard, or the API), then run this to flip premium.

Usage:
    python -m scripts.dev_trigger_webhook <payment_id>
    python -m scripts.dev_trigger_webhook <payment_id> --url http://localhost:8000
    BACKEND_URL=http://10.0.2.2:8000 python -m scripts.dev_trigger_webhook <payment_id>

Exit codes: 0 = backend returned 2xx (it accepted + re-verified), 1 = bad args / network / non-2xx.
This is a DEV tool — it only mimics the notification envelope; the backend remains the source of truth.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
WEBHOOK_PATH = "/billing/yookassa/webhook"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="POST a YooKassa payment.succeeded notification to the local backend.")
    parser.add_argument("payment_id", help="The YooKassa payment id to verify + grant (real test-mode id).")
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Backend base URL (default {DEFAULT_URL}; or set BACKEND_URL).",
    )
    args = parser.parse_args(argv)

    target = args.url.rstrip("/") + WEBHOOK_PATH
    # The exact envelope YooKassa sends; the backend uses ONLY object.id, then re-fetches.
    body = json.dumps({"event": "payment.succeeded", "object": {"id": args.payment_id}}).encode()
    req = urllib.request.Request(
        target, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )

    print(f"POST {target}")
    print(f"  payment_id = {args.payment_id}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode()
            print(f"← {resp.status} {payload}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        print(f"← {exc.code} {detail}", file=sys.stderr)
        if exc.code == 404:
            print(
                "  404 → billing is OFF (BILLING_ENABLED not true) or the backend isn't running.",
                file=sys.stderr,
            )
        elif exc.code == 502:
            print(
                "  502 → the backend could not re-fetch the payment from YooKassa "
                "(check YOOKASSA_SHOP_ID/SECRET_KEY are the TEST creds and the id exists in test mode).",
                file=sys.stderr,
            )
        return 1
    except urllib.error.URLError as exc:
        print(f"network error reaching {target}: {exc.reason}", file=sys.stderr)
        print("  Is the backend up? Try --url http://localhost:8000", file=sys.stderr)
        return 1

    print("ok — if the payment was 'succeeded' for a known user/plan, premium is now granted (idempotent).")
    print("Verify: the test user's /auth/me now shows the Black Belt entitlement.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
