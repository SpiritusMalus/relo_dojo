# Relo Dojo — Backend Build Brief

You already know this codebase and have the same files. This is **not** a re-introduction — it's the
backend contract to build against the existing client. Reference points you have:
- `dojo-flows.jsx` (Login, Onboarding, Topics) · `dojo-home.jsx` (HomePath) · `dojo-practice.jsx`
  (Practice) · `dojo-progress.jsx` (Progress) · `dojo-extras.jsx` (Settings, sheets, scroll, ceremony)
  · `dojo-app.jsx` (Stage: state + sheet wiring) · `dojo-core.jsx` (belts, Sensei).
- `HANDOFF_v2.md` — what each feature does + the "backend to finish" notes per section. **Read it; this
  file is the API layer those notes call for.**

The mock fakes everything with React state and Tweaks (e.g. `account`, `streakDemo`, `colorBelt`,
`uiLang`, belt selection). Your job: replace those fakes with real persistence + a server-authoritative
gamification engine. Stack is yours (mock targets Expo/RN); assumptions below are swappable.

---

## Non-negotiables (the mock cheats on these — the server must not)
1. **Server is the only source of truth** for XP, level, streak, belt/CEFR, lesson unlock state, and the
   email-verification gate. The client currently derives all of this locally — move it server-side and
   treat client values as untrusted.
2. **Promotion is server-decided.** The belt sheet in `dojo-app.jsx` (`BeltSheet`/`setBelt`) is a *demo
   skin-preview*. Real belt changes happen only when the engine promotes you; the client just reacts by
   playing `BeltCeremony` off a `promotion` flag.
3. **Gating is enforced in the API, not just UI.** `HomePath` dims/locks path nodes when
   `verified===false` and for `next`/`locked` states — return those states from the server and `403`
   the underlying lesson/attempt.
4. **Cosmetics stay client-side, derived from `belt_id`/`cefr`:** avatar maturation (student ages by
   rank, `dojo-core.jsx`), belt-driven theming, the Sensei look. No backend fields for these.

---

## Data model (Prisma-ish; adapt) — see `schema.prisma`
```
User           id, email⊥, password_hash, email_verified_at, timezone, created_at
Profile        user_id 1:1, display_name, belt_id, cefr, xp_total, level,
               streak_count, streak_best, last_active_date, daily_goal_target=6,
               color_belt('auto'|belt_id), theme('light'|'dark'|'system'), ui_lang='en',
               training_lang='en', sound=true, haptics=true, daily_reminder=true
Belt           id('white'..'black'), cefr, order_index, name                 # seed: white·A1…black·C2
Topic          id, slug, label, cefr, order_index, lang
Lesson         id, topic_id, label, order_index, kind('lesson'|'belt_test'), cefr
Exercise       id, lesson_id, type('build_sentence'|…), prompt, answer_tokens[],
               distractor_tokens[], audio_text, difficulty
Attempt        id, user_id, exercise_id, lesson_id, is_correct, answer_tokens[],
               duration_ms, xp_awarded, created_at
LessonProgress user_id, lesson_id, state('locked'|'next'|'current'|'done'), accuracy_pct, mastered_at  # uniq
TopicProgress  user_id, topic_id, accuracy_pct, attempts, last_practiced_at
Achievement    id, slug, label, description, glyph, criteria_json            # seed
UserAchievement user_id, achievement_id, unlocked_at, progress_pct
Session        id, user_id, started_at, ended_at, correct, total, xp_earned
Wish           id, user_id, text, kind('lang_request'|'general'), requested_lang?, context_json, status
Proverb        id, jp, romaji, en, seal, tier('normal'|'gold'), lang        # seed (matches dojo-extras KOTOWAZA)
EmailToken     user_id, token, purpose('verify'|'reset'), expires_at
RefreshToken   user_id, token_hash, expires_at, revoked_at
DeviceToken    user_id, token, platform
```
Seed `Proverb` from the `KOTOWAZA` / `KOTOWAZA_GOLD` arrays in `dojo-extras.jsx` (gold tier = the rare
long-streak deck). Seed belts to match `BELTS` in `dojo-core.jsx`.

---

## Gamification engine (one tested service)
- **XP:** correct = 10 × difficulty; wrong = 0. Server computes; ignore client XP.
- **Level:** `floor(sqrt(xp_total/100)) + 1`; return `xp_to_next`.
- **Streak:** on first **correct** attempt of the user-local day — `yesterday`→++, `today`→no-op, else→1;
  update `streak_best`. Break via nightly job + lazy check on read.
- **Daily goal:** completed drills today vs `daily_goal_target` → `{done,target}` for the Home hero.
- **Promotion:** finishing a belt's topic path + passing its `belt_test` (≥ threshold) bumps
  `belt_id`/`cefr`, unlocks that belt's colour for `color_belt`, and sets `promotion` in the attempt
  response. **Gold proverbs** unlock at `streak_count ≥ 7`.
- **Gate:** `done`+`current` always open; `next` opens when prior `done`; rest `locked`. If
  `email_verified_at IS NULL` → force everything past `current` to `locked`.

---

## Endpoints (`/api/v1`, JSON, JWT access+refresh, verify required) — see `openapi.yaml`
```
AUTH      POST /auth/register · /login · /refresh · /logout · /verify-email · /resend-verification
          · /forgot-password · /reset-password
ONBOARD   POST /onboarding · /onboarding/placement · /onboarding/reset
CORE      GET  /me · /home · /progress
CONTENT   GET  /topics · /topics/:id · /lessons/:id (403 if locked/unverified)
PRACTICE  GET  /practice/next?topic=&mode=daily_mix · GET /tts?text=
          POST /attempts (Idempotency-Key) · POST /sessions
PREFS     PATCH /me/preferences · GET /languages
SOCIAL    POST /feedback · GET /proverbs/today?streak=
PUSH      POST /devices
```
`GET /home` returns exactly what `HomePath` needs: `{belt, streak, xp, level, daily_goal{done,target},
path[{id,label,state,topic?,accuracy}], verified, proverb}`.
`POST /attempts` returns `{is_correct, correct_answer, xp_awarded, streak, level, lesson_state, promotion?}`.

---

## Button → endpoint (bind to existing handlers)
**Login** (`Login`): submit / "Enter the dojo" → `POST /auth/login` (first login → onboarding) ·
"Forgot password?" → `POST /auth/forgot-password`.
**Onboarding** (`Onboarding`, `onDone(belt)`): warm-up → `POST /onboarding/placement` (assigns belt) ·
finish/"Get started" → `POST /onboarding` · "Skip" → default white/A1.
**Home** (`HomePath`): belt pill `onBelt` → belt sheet (from `/me`) · gear `onSettings` → Settings ·
`VerifyBanner`/`onVerify` → `POST /auth/resend-verification` then verify sheet · "Daily mix" `onStart`
→ `GET /practice/next?mode=daily_mix` · path node `tap`/`onTopic` → `GET /lessons/:id` +
`/practice/next?topic=` (**403 if gated**) · "Browse all topics" `onTopics` → `GET /topics` · scroll
tap → cycle / `GET /proverbs/today` · belt-hero avatar → cosmetic, no call.
**Practice** (`Practice`): "Listen" → `GET /tts?text=` · "Check" → `POST /attempts`
(returns correctness, xp, streak, `lesson_state`, `promotion?`) · "Continue" → `GET /practice/next` ·
"Close"/summary → `POST /sessions`.
**Progress** (`Progress`): all stats/topics/achievements ← `GET /progress` · "Talk to Sensei"
`onWish` → feedback sheet.
**Settings** (`Settings` in `dojo-extras.jsx`): theme → `PATCH /me/preferences {theme}` · app language
→ `{ui_lang}` · dojo colour (`onColorBelt`) → `{color_belt}` (**server validates belt earned**) ·
training language tap (non-en) → `POST /feedback {kind:'lang_request', requested_lang}` · sound/haptics/
daily reminder toggles → `PATCH /me/preferences {…}` (reminder also schedules/cancels notifications) ·
account status ← `GET /me` (`email_verified_at`) · "Confirm email" → `POST /auth/resend-verification` ·
"Redo onboarding" `onRedo` → `POST /onboarding/reset` · "Log out" `onLogout` → `POST /auth/logout`.
**Sheets** (`dojo-app.jsx`, `dojo-extras.jsx`): `BeltSheet` pick = preview only (no write; promotion is
server-driven) · `BeltCeremony` "Wear it" = ack of a persisted promotion · `VerifyEmailSheet`
"I've confirmed" → re-`GET /me`; "Resend link" → `POST /auth/resend-verification` · `TalkToSensei`
"Send" → `POST /feedback {text, kind, context:{belt,locale}}` · `SenseiBio` "Hear today's wisdom" →
`GET /proverbs/today`.

---

## Edge cases & acceptance
- `403` locked/unverified lessons; `409` attempts against them. Idempotency-Key on `/attempts` (no
  double XP on replay). Streak computed from `last_active_date`+timezone only. `color_belt` ⊆ earned
  belts. `training_lang` only settable to a shipped-content language; else it's a `lang_request`.
  Rate-limit + sanitize auth/feedback.
- **Deliver:** migrations + seed (belts, topics, lessons, exercises, proverbs, achievements) so the
  client runs E2E; OpenAPI for `/api/v1`; unit tests for the engine (XP, streak rollover across
  timezones, promotion, gating); HTTP collection covering every binding above.
- **Done =** register → verify → onboard → practice → earn XP → hold a streak → get promoted → change
  prefs → send feedback, all against the real API, with every gate enforced server-side.
