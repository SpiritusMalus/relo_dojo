# RUNBOOK — test the premium pay-rail locally (Android emulator, YooKassa TEST)

Unlock premium for a **test user** on a **local** Android emulator — backend + checkout page + YooKassa
**test** mode, no prod deploy, no Play/Apple account, no real money. The payment code is already merged
(PR #47/#48); this runbook just stands the rail up so you can exercise it end-to-end.

The loop:

```
app (emulator) ── Custom Tab ──▶ local checkout page ──▶ YooKassa test checkout
   ▲                                                            │ pay (test card)
   │ premium unlocks on /auth/me refetch                        ▼
   └──────────── relodojo://premium ◀──── done.html ◀──── return_url
                                   (webhook grants out-of-band — see step 5)
```

## 0. One-time owner input (NOT code — supply at runtime)

- **YooKassa TEST shop**: shopId + secret key from the YooKassa dashboard (тестовый магазин). TEST
  mode = test cards, no real money. *(Per the brief, TEST shop `1392628` is already wired into the
  gitignored `backend/.env` — if so, skip the cred paste below and just confirm step 2.)*

## 1. Backend — billing ON with test creds

```bash
cd backend
cp deploy/.env.local.example .env        # then fill SET_* markers (DB url, TEST shop creds)
# Key lines: BILLING_ENABLED=true, YOOKASSA_SHOP_ID/SECRET_KEY=<TEST>, YOOKASSA_API_URL=https://api.yookassa.ru/v3
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` so the emulator can reach it at `http://10.0.2.2:8000` (10.0.2.2 = the host machine
as seen from the Android emulator; `localhost` inside the emulator is the emulator itself).

## 2. Confirm the rail is live

```bash
curl -s http://localhost:8000/billing/plans
```

Expect **HTTP 200** + the 3 plans (`black_belt_1m/3m/12m`). A **404** means `BILLING_ENABLED` is not
`true` (the whole `/billing/*` surface stays invisible until the flag flips — `config.py:185`).
*(Covered by `backend/tests/test_billing.py::test_plans_returns_all_three_when_billing_enabled`.)*

## 3. Serve the checkout page

```bash
marketing/checkout/serve.sh        # binds 0.0.0.0:8080; emulator → http://10.0.2.2:8080/index.html
```

## 4. Wire the app to the local hosts

The app reads two `EXPO_PUBLIC_*` vars (mobile/services/billing.ts + api.ts):

```bash
export EXPO_PUBLIC_API_URL=http://10.0.2.2:8000               # backend base
export EXPO_PUBLIC_CHECKOUT_URL=http://10.0.2.2:8080/index.html
```

`buildCheckoutUrl()` then produces the page URL with the session in the **fragment**:
`http://10.0.2.2:8080/index.html#api=http://10.0.2.2:8000&token=<JWT>&lang=ru`. The page's host
allowlist accepts `10.x` (and `localhost`), so `10.0.2.2` is permitted. `billingEnabled()` is true
because `EXPO_PUBLIC_CHECKOUT_URL` is set.

## 5. Webhook without a public host (the local default)

YooKassa can't POST to `localhost`. But the backend **doesn't trust the POST body** — it reads only the
payment id, then re-fetches the payment from the YooKassa API to verify status + metadata before
granting (`app/services/yookassa.py`). So trigger the notification yourself with the real test payment
id (from the `/billing/checkout` response, or the YooKassa test dashboard):

```bash
cd backend
.venv/bin/python -m scripts.dev_trigger_webhook <payment_id>
# or against the emulator-facing host:
BACKEND_URL=http://10.0.2.2:8000 .venv/bin/python -m scripts.dev_trigger_webhook <payment_id>
```

The backend re-fetches, sees `succeeded` + the `user_id`/`plan` metadata, and grants idempotently.

### 5b. (Optional) fully-automatic webhook via a tunnel

Expose the local backend and register that URL in the YooKassa dashboard so real notifications arrive:

```bash
cloudflared tunnel --url http://localhost:8000      # or: ngrok http 8000
```

Then in the YooKassa dashboard → **Settings → HTTP notifications**, set the webhook to
`https://<tunnel-host>/billing/yookassa/webhook` for the `payment.succeeded` event. **No signature
secret to configure** — the adapter re-fetches by design (the URL is the only thing it needs). With the
tunnel live, paying a test card grants premium automatically and you can skip the manual trigger.

## 6. Mobile — local dev client (NOT a store build)

The `relodojo://premium` deep-link return does **not** work under Expo Go (`exp://` scheme), so build a
local **dev client** — this needs **no** Play Console / Apple account:

```bash
cd mobile
npx expo run:android            # or: eas build --profile development --local
```

Launch it on a running emulator (`emulator -avd <name>` or Android Studio → Device Manager).

## 7. Run the loop

1. Sign in / register a **test user** in the app.
2. Profile → **Чёрный пояс** (Black Belt) → tap buy. (Android only — iOS is reader-mode, no buy UI.)
3. The Custom Tab opens the local checkout → pick a plan → **Оплатить**.
4. Pay with a YooKassa **test card** (e.g. the success test card from the YooKassa test-card list).
5. YooKassa returns the tab to `done.html`. **Close the tab** (tap Done) — `done.html` doesn't
   auto-redirect to the app scheme, so close it manually; either way the app refetches on return.
6. Grant premium: run **step 5** (`dev_trigger_webhook <payment_id>`) — unless the tunnel (5b) is live,
   which grants automatically.
7. Back in the app: entitlement refetch + a single 2.5 s retry (`app/premium.tsx`) flips the test user
   to premium. Confirm Black Belt is now unlocked.

## Notes / gotchas

- **iOS**: reader mode by design — no buy button (playbook §3). The only iOS check is "no purchase UI +
  Restore works", not a payment.
- **СБП** is generally unavailable in YooKassa test mode → local e2e uses a **test card**; СБП is
  verified only on staging/live.
- **Test vs live keys**: everything here is TEST. Never promote `backend/.env` (test creds) to prod —
  prod uses `deploy/.env.prod.example` with separate LIVE keys.
- This runbook changes **no** payment/gating logic — it only adds the local env template, the serve
  script, the webhook-trigger script, and these docs.
