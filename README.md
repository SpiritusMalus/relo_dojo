# Relo Dojo

English practice in a calm dojo: short adaptive lessons, clear feedback, belts,
scrolls and a server-owned koku wallet. Expo SDK 54 / React Native client and a
Python 3.12 / FastAPI backend with PostgreSQL accounts and progress synchronization.

## Learning behavior

Each checked answer updates the selected topic before the next card is chosen.
Accuracy, foreground solving time, hints, recent formats and accumulated evidence
influence practice. Slow correct answers receive a smaller increase; mistakes and
assisted answers do not count as independent mastery. Belt offers require actual
practice evidence. Placement is a preliminary estimate, not an earned belt or a
certified CEFR result.

AI-authored exercises use structured-output contracts, local shape/key checks and
a separate semantic review. Rejected content receives a bounded retry and, if
necessary, one stronger repair. A small authored safety net carries its actual
level and `source=curated`. Policy refusals fail clearly without entering that path.
Keyed answers are graded deterministically from sealed tokens; free text, writing
and listening retells are assessed by a model.

The evaluated OpenRouter configuration is Gemini 3.5 Flash Lite for generation,
GPT-6.1 Terra for semantic review/explanations/writing/planning, and Gemini 3.8 Flash for one
bounded repair. Audio transcription keeps its separate compatible model. See
[model selection and real-provider evidence](backend/evals/MODEL_SELECTION.md).

## My Dojo

Home points to a due review or the next course step. Lesson results show the actual
XP and koku received, with a direct way to finish or open the dojo.

The room has three fixed positions and eight decorative variants. Complete ten
server-issued exercises to record a practice day; the first, third and seventh
nonconsecutive UTC practice days unlock a scroll, bamboo and lantern. Decorations
use the existing cosmetic inventory and never change difficulty or earned belts.
Dojo Plus is the membership name, separate from belt progression.

Apply migration `0019_dojo_practice` before enabling `DOJO_ENABLED=true`. The flag
defaults off. Sessions, grants and purchases are idempotent; cached room state is
account-scoped and can be viewed offline, while changes require a connection.

## Development

Provision a local PostgreSQL database, then configure `backend/.env` from
[the example](backend/.env.example). `DATABASE_URL` and `JWT_SECRET` are required;
production also requires a persistent `CHECK_SECRET`. Keep credentials outside Git.
Apply migrations deliberately against the intended development database:

```sh
cd backend
python3.12 -m venv .venv312
.venv312/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv312/bin/alembic upgrade head
.venv312/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In another terminal:

```sh
cd mobile
npm ci
npx expo start
```

Expo Go must match SDK 54. `EXPO_PUBLIC_API_URL` overrides the development-host
inference; configure a reachable backend when using a physical phone. OpenRouter
calls are billable and require a funded, appropriately permitted key. Offline tests
use stubs and do not call providers or a live database.

## Verification

```sh
cd backend
./.venv312/bin/python -m pytest -q
```

```sh
cd mobile
npx tsc --noEmit
npm test -- --runInBand
```

CI runs the backend suite, TypeScript and mobile tests. The separate manual
[Android workflow](.github/workflows/android-apk.yml) builds an internal APK.
Device acceptance remains a separate check: build success and model fixtures do
not prove navigation, audio, persistence or account switching.

## Delivery and scope

- [Android development and internal builds](mobile/README.md)
- [Backend deployment, revision checks and rollback](backend/deploy/DEPLOY.md)
- [Product direction](PRODUCT.md) and [design tokens](DESIGN.md)

The current target is an Android test release with the HTTPS backend at
`https://relo.family-pie.ru`. Internal APKs use test signing unless explicitly built
with managed release credentials. Store publication, physical-device/iOS acceptance,
real payments, mail delivery and Live voice require their own verification.
Private task journals and native evidence live in the protected project context.
