# Privacy Policy — Relo Dojo

**Effective date:** [INSERT DATE]
**Operator ("we", "us"):** [INSERT LEGAL NAME / SOLE PROPRIETOR] ("Relo Dojo")
**Contact:** [INSERT CONTACT EMAIL]

> Draft prepared for the app stores. The factual descriptions below match how the app actually
> works; the bracketed fields and the governing-law section must be completed by the operator, and
> the whole document should be reviewed by a qualified lawyer before publication. This is not legal
> advice.

Relo Dojo is a mobile app for learning English through short daily grammar exercises. This policy
explains what we collect, why, and your choices.

## Summary

- We collect the minimum needed to run your account and the learning loop: your email, a securely
  hashed password, and your learning progress.
- We process the text you submit for exercises and feedback (your answers, your stated goal, and any
  text you paste into "Review my text") to generate the lesson and the explanation.
- We collect privacy-preserving usage events to measure whether the app helps people return (we do
  not put your lesson text or personal details into these events).
- We do **not** sell your data, and we do **not** show third-party advertising.

## What we collect

**Account data.** Your email address and a password. Passwords are stored only as a salted hash
(argon2id) — we never store or can read your actual password. We also keep a verification flag
(whether you confirmed your email) and your account creation context.

**Learning data.** Your progress: experience points, streaks, per-topic statistics, achievements,
belts, and the in-app "koku" balance and items. Your onboarding answers (your field/sphere, goals,
self-assessed level, daily-time target, and tone preference) and an optional free-text goal. This is
synced to your account so it follows you across devices.

**Content you submit.** The answers you give to exercises, and any text you voluntarily paste into
features such as "Review my text" or the free-text goal box. We use this to grade, generate, and
explain lessons (see "AI processing" below).

**Usage analytics.** Privacy-preserving event records (for example: app opened, session completed,
an exercise answered, a paywall viewed) used to measure retention and improve the app. These events
contain only short, non-identifying values (counts, screen names, true/false flags) — not the text
of your answers or messages. Before you sign in, events are tied to a random device identifier, not
to you.

**Device/technical data.** Standard information needed to deliver the service, such as your IP
address at the time of a request (used transiently for security and rate limiting) and your app
language preference.

We do **not** intentionally collect special categories of data, precise location, contacts, photos,
or microphone/camera input.

## AI processing of your text

To generate exercises and feedback, the text you submit is processed by a language model. In
production this is **Google LLC** (the **Gemini 3.1 Flash-Lite** model), acting as our processor
under Google's terms; the model runs on Google's infrastructure in the **United States**. (In local
development the operator may run an on-server model instead; no user data leaves the server in that
mode.) We send only the content needed for the task (your answer, your stated goal, or the text you
chose to review) plus your tone/level settings; we do **not** send your email or password to the
model. We instruct the system to treat your text strictly as data to evaluate.

Because this provider processes your text in the United States, using these AI features involves a
**cross-border transfer of personal data** — see "Cross-border transfer of your text" below.

## Cross-border transfer of your text

- **Recipient:** Google LLC (Gemini), United States.
- **What is transferred:** only the text you enter for an AI task — your exercise answers, your
  stated goal, and any text you paste into "Review my text" — together with your tone/level
  settings. Never your email, password, or other account identifiers.
- **Purpose:** to grade your answers and to generate lessons and explanations for you.
- **Your consent:** for users in Russia, this transfer is made on the basis of your **separate,
  specific consent**, which you give on a dedicated consent screen in the app (it is not part of the
  Terms of Use). You can decline; the rest of the app remains usable, and you may be offered the
  on-server model where available.
- **Withdrawing consent:** you can withdraw at any time by deleting your account in the app's
  Settings (which stops all further processing of your data) or by contacting us at
  [INSERT CONTACT EMAIL]. Withdrawal does not affect processing already carried out.

## How we use your data

- Create and secure your account, and verify your email.
- Provide the learning experience: generate exercises, grade answers, give explanations, sync
  progress, and run the gamified economy (XP, streaks, koku, cosmetics).
- Send local reminders/notifications from the app (you can disable these in your device settings).
- Measure retention and product quality through aggregate analytics.
- Protect the service (rate limiting, abuse and fraud prevention).

We rely on the following legal bases where applicable: performance of our agreement with you (to run
your account and lessons), your consent (notifications and optional free-text features), and our
legitimate interests (security and product improvement).

## Email

Account-activation and related transactional emails are sent via an SMTP email provider configured
by the operator. We do not send marketing email unless you separately opt in.

## Payments

Relo Dojo offers an optional paid premium ("Black Belt"). Payments for premium are processed by our
payment provider **YooKassa (ЮMoney / YooKassa)**. When you choose to pay, you are taken to
YooKassa's secure checkout and enter your card (or other supported method) details there: we do
**not** collect, see, or store your full card number, CVV, or other card data — YooKassa handles that
as the payment operator. We receive from YooKassa only what we need to grant and support your
purchase: the payment status, an order/transaction identifier, the amount and currency, and the
premium plan you bought (we do not store card data). Premium status is then recorded against your
account as an internal flag. YooKassa processes payment data as an independent operator under its own
terms and privacy policy.

## Sharing

We share data only with service providers that help us run the app — our server/hosting, the email
provider, the AI provider (**Google LLC**, for the text-processing features described above), and,
when you make a purchase, our payment provider **YooKassa (ЮMoney / YooKassa)**, which processes your
payment and card data as described in "Payments" above. We may disclose data if required by law. We do
not sell personal data and do not share it for advertising.

## Retention

We keep account and progress data for as long as your account exists. Analytics events are retained
only as long as needed to measure retention and may be automatically purged after a configured
period. When you delete your account, we delete or anonymize your associated data within a reasonable
period, except where we must retain it to comply with law.

## Your rights

Depending on where you live, you may have the right to access, correct, export, or delete your data,
and to object to or restrict certain processing. To exercise these rights, or to delete your account
and data, contact us at [INSERT CONTACT EMAIL]. You can also stop notifications at any time in your
device settings.

## Children

Relo Dojo is not directed to children under [13 / 16 — choose per your markets]. We do not
knowingly collect data from children under that age. If you believe a child has provided us data,
contact us and we will delete it.

## Security

We use industry-standard measures including hashed passwords (argon2id), authenticated sessions
(expiring tokens), encrypted answer tokens, transport security, restricted cross-origin access, and
rate limiting. No method of transmission or storage is completely secure, but we work to protect
your data.

## International transfers

Your **account and learning data** (email, hashed password, progress, learner profile) are stored on
our primary database, which is hosted **in the Russian Federation**. The **text you submit for AI
features** is, with your separate consent, transferred to **Google LLC in the United States** for
processing as described in "Cross-border transfer of your text" above; that is the only routine
transfer of your data outside Russia. Where additional safeguards are required for the markets we
serve, we put them in place. [Operator: confirm the RF hosting region/provider and, if you serve
EU/UK users, your transfer mechanism.]

## Changes

We may update this policy. We will post the new effective date here and, for material changes,
provide a notice in the app.

## Contact

[INSERT LEGAL NAME] — [INSERT CONTACT EMAIL] — [INSERT POSTAL ADDRESS IF REQUIRED BY YOUR STORE/MARKET]
