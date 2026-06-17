# API examples — request / response per call

Concrete JSON for every endpoint in `openapi.yaml`. Base: `/api/v1`. All calls except the `security: []`
ones send `Authorization: Bearer <access_token>`. Seed values match the mock (`reference/dojo-core.jsx`):
belts white·A1 … black·C2, topics like `prepositions`, exercises of type `build_sentence`.

XP rule: correct = `10 × difficulty`, wrong = 0. Level = `floor(sqrt(xp_total/100)) + 1`.

---

## AUTH

### POST /auth/register
```json
// → request
{ "email": "leo@example.com", "password": "correct horse battery" }
// ← 201
{ "access_token": "eyJhbGci...", "refresh_token": "f1c2...", "token_type": "bearer" }
// ← 409  (email taken — generic, no existence leak in copy)
{ "error": "registration_failed", "message": "Could not complete registration." }
```

### POST /auth/login
```json
// → request
{ "email": "leo@example.com", "password": "correct horse battery" }
// ← 200
{ "access_token": "eyJhbGci...", "refresh_token": "f1c2...", "token_type": "bearer" }
// ← 401
{ "error": "invalid_credentials" }
```

### POST /auth/refresh
```json
{ "refresh_token": "f1c2..." }
// ← 200
{ "access_token": "eyJ...new", "refresh_token": "f1c2...rotated", "token_type": "bearer" }
```

### POST /auth/logout
```
// → (bearer only, empty body)   ← 204 No Content
```

### POST /auth/verify-email
```json
{ "token": "verif_a1b2c3" }
// ← 200  (returns the now-verified Me)
{ "id": "u_1", "email": "leo@example.com", "email_verified_at": "2026-06-14T10:05:00Z", "belt": { "id": "white", "cefr": "A1", "name": "White belt", "order_index": 0 }, "cefr": "A1", "level": 1, "xp_total": 0 }
```

### POST /auth/resend-verification
```
// → (bearer only)   ← 202 Accepted
```

### POST /auth/forgot-password
```json
{ "email": "leo@example.com" }
// ← 202  (always, even if unknown)
```

### POST /auth/reset-password
```json
{ "token": "reset_x9y8", "password": "new pass phrase" }
// ← 200
```

---

## ONBOARDING

### POST /onboarding/placement
```json
// → warm-up results
{ "answers": [
  { "exercise_id": "ex_p1", "is_correct": true },
  { "exercise_id": "ex_p2", "is_correct": false },
  { "exercise_id": "ex_p3", "is_correct": true }
] }
// ← 200  (2/5 → Pre-Intermediate → A2/yellow, matching the owner profile)
{ "belt": { "id": "yellow", "cefr": "A2", "name": "Yellow belt", "order_index": 1 }, "cefr": "A2" }
```

### POST /onboarding
```json
// → request
{ "domain": "software", "goals": ["speak at standups", "write clear PRs"],
  "goal_text": "I want to stop freezing in English standups", "skip": false }
// ← 200  (Me)
{ "id": "u_1", "email": "leo@example.com", "belt": { "id": "yellow", "cefr": "A2", "name": "Yellow belt", "order_index": 1 }, "cefr": "A2", "xp_total": 0, "level": 1, "daily_reminder": true }
```

### POST /onboarding/reset
```
// → (bearer only)   ← 200 → Me reset to pre-onboarding defaults (white/A1)
```

---

## CORE

### GET /me
```json
// ← 200
{
  "id": "u_1", "email": "leo@example.com", "email_verified_at": null,
  "display_name": null,
  "belt": { "id": "yellow", "cefr": "A2", "name": "Yellow belt", "order_index": 1 },
  "cefr": "A2", "xp_total": 240, "level": 2, "xp_to_next": 160,
  "streak_count": 3, "streak_best": 5,
  "color_belt": "auto", "theme": "light", "ui_lang": "en", "training_lang": "en",
  "sound": true, "haptics": true, "daily_reminder": true
}
```

### GET /home
```json
// ← 200  (exactly what HomePath renders; verified=false dims/locks nodes past `current`)
{
  "belt": { "id": "yellow", "cefr": "A2", "name": "Yellow belt", "order_index": 1 },
  "streak": 3, "xp": 240, "level": 2,
  "daily_goal": { "done": 2, "target": 6 },
  "path": [
    { "id": "l_articles",     "label": "Articles",     "state": "done",    "topic": "articles",     "accuracy": 69 },
    { "id": "l_modals",       "label": "Modal verbs",  "state": "current", "topic": "modals",       "accuracy": 63 },
    { "id": "l_prepositions", "label": "Prepositions", "state": "next",    "topic": "prepositions", "accuracy": null },
    { "id": "l_a2_test",      "label": "Yellow belt test", "state": "locked", "topic": null,        "accuracy": null }
  ],
  "verified": false,
  "proverb": { "id": "pv_1", "jp": "七転び八起き", "romaji": "nana korobi ya oki", "en": "Fall seven times, stand up eight.", "seal": "忍", "tier": "normal" }
}
```

### GET /progress
```json
// ← 200
{
  "xp_total": 240, "level": 2, "streak_count": 3, "streak_best": 5,
  "topics": [
    { "id": "prepositions", "label": "Prepositions", "accuracy_pct": 74, "attempts": 41 },
    { "id": "conditionals", "label": "Conditionals", "accuracy_pct": 58, "attempts": 33 },
    { "id": "phrasal",      "label": "Phrasal verbs", "accuracy_pct": 47, "attempts": 18 }
  ],
  "achievements": [
    { "slug": "first",   "label": "First steps",  "glyph": "🥋", "unlocked": true,  "progress_pct": 100 },
    { "slug": "streak3", "label": "On a roll",    "glyph": "🔥", "unlocked": true,  "progress_pct": 100 },
    { "slug": "hundred", "label": "Centurion",    "glyph": "💯", "unlocked": false, "progress_pct": 64 },
    { "slug": "streak7", "label": "Full week",    "glyph": "📅", "unlocked": false, "progress_pct": 71 }
  ]
}
```

---

## CONTENT

### GET /topics
```json
// ← 200
[
  { "id": "t_prepositions", "slug": "prepositions", "label": "Prepositions", "cefr": "B1" },
  { "id": "t_conditionals", "slug": "conditionals", "label": "Conditionals", "cefr": "A2" },
  { "id": "t_tenses",       "slug": "tenses",       "label": "Verb tenses",  "cefr": "B2" }
]
```

### GET /topics/{id}
```json
// ← 200  GET /topics/t_prepositions
{ "id": "t_prepositions", "slug": "prepositions", "label": "Prepositions", "cefr": "B1",
  "lessons": [ { "id": "l_prep_1", "label": "in / on / at", "state": "current" } ] }
```

### GET /lessons/{id}
```json
// ← 200
{ "id": "l_prep_1", "topic_id": "t_prepositions", "label": "in / on / at", "kind": "lesson", "state": "current" }
// ← 403  (locked, or account unverified)
{ "error": "lesson_locked", "message": "Verify your email to unlock this lesson." }
```

---

## PRACTICE

### GET /practice/next?mode=daily_mix
```json
// ← 200  (tokens = answer + distractors, shuffled; from the BUILD bank)
{
  "id": "ex_prep_42", "lesson_id": "l_prep_1", "type": "build_sentence",
  "prompt": "I pushed the fix ___ the main branch.",
  "tokens": ["to", "in", "the", "main", "branch", "at"],
  "audio_text": "I pushed the fix to the main branch", "difficulty": 2
}
```

### GET /practice/next?topic=prepositions
```json
// ← 403  (topic gated behind an earlier lesson, or unverified)
{ "error": "lesson_locked" }
```

### GET /tts?text=...
```
// → GET /tts?text=I%20pushed%20the%20fix%20to%20the%20main%20branch
// ← 200  Content-Type: audio/mpeg   (binary body)
```

### POST /attempts   (header: Idempotency-Key: 9f3c-...)
```json
// → correct answer
{ "exercise_id": "ex_prep_42", "lesson_id": "l_prep_1",
  "answer_tokens": ["I","pushed","the","fix","to","the","main","branch"], "duration_ms": 8200 }
// ← 200  (10 × difficulty 2 = 20 XP; streak advanced; no promotion this card)
{ "is_correct": true, "correct_answer": "I pushed the fix to the main branch",
  "xp_awarded": 20, "streak": 4, "level": 2, "lesson_state": "current", "promotion": null }

// ← 200  (wrong answer)
{ "is_correct": false, "correct_answer": "I pushed the fix to the main branch",
  "xp_awarded": 0, "streak": 4, "level": 2, "lesson_state": "current", "promotion": null }

// ← 200  (the attempt that finishes the belt test → promotion fires; client plays BeltCeremony)
{ "is_correct": true, "correct_answer": "...", "xp_awarded": 30, "streak": 5, "level": 3,
  "lesson_state": "done",
  "promotion": { "belt": { "id": "orange", "cefr": "B1", "name": "Orange belt", "order_index": 2 },
                 "cefr": "B1", "unlocked_color": "orange" } }

// ← 409  (attempt against a locked/unverified lesson)
{ "error": "lesson_locked" }
// Replay with the same Idempotency-Key → original result, no second XP award.
```

### POST /sessions
```json
// → close session
{ "started_at": "2026-06-14T10:00:00Z", "correct": 9, "total": 10 }
// ← 201
{ "correct": 9, "total": 10, "xp_earned": 170 }
```

---

## PREFS

### PATCH /me/preferences
```json
// → theme + dojo colour (color_belt must be an EARNED belt)
{ "theme": "dark", "color_belt": "yellow" }
// ← 200  (Me, updated)
{ "id": "u_1", "theme": "dark", "color_belt": "yellow", "belt": { "id": "yellow", "cefr": "A2", "name": "Yellow belt", "order_index": 1 } }
// ← 422  (color_belt not yet earned)
{ "error": "belt_not_earned", "message": "You haven't earned the green belt yet." }

// → toggles (daily_reminder also (de)schedules a notification)
{ "sound": false, "haptics": true, "daily_reminder": true }
```

### GET /languages
```json
// ← 200  (only shipped=true is settable as training_lang; others become a lang_request)
[
  { "code": "en", "label": "English", "shipped": true },
  { "code": "es", "label": "Spanish", "shipped": false },
  { "code": "de", "label": "German",  "shipped": false }
]
```

---

## SOCIAL

### POST /feedback
```json
// → Talk to Sensei (general)
{ "text": "More phrasal-verb drills please", "kind": "general",
  "context": { "belt": "yellow", "locale": "en" } }
// ← 201

// → training-language request (non-shipped language tapped in Settings)
{ "kind": "lang_request", "requested_lang": "es",
  "context": { "belt": "yellow", "locale": "en" } }
// ← 201
```

### GET /proverbs/today?streak=7
```json
// ← 200  (streak >= 7 → gold tier deck)
{ "id": "pv_g3", "jp": "石の上にも三年", "romaji": "ishi no ue ni mo san nen",
  "en": "Three years on a cold stone.", "seal": "道", "tier": "gold" }
```

---

## PUSH

### POST /devices
```json
{ "token": "ExponentPushToken[xxxx]", "platform": "ios" }
// ← 201
```
