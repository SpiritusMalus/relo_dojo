# Backend handoff kit — Grammar Dojo

Companion artifacts for the Backend Build Brief. Hand the **whole `mobile/` repo + the mock**
(`reference/Grammar Dojo.html` and the `dojo-*.jsx` files) to the executor together with this folder —
the prompt is the task, the files are the context.

| File | What it is |
|---|---|
| `BACKEND_PROMPT.md` | The brief = the task. Paste it, or say "do BACKEND_PROMPT.md". |
| `schema.prisma` | Data model from the brief, as valid Prisma (ER contract; adapt to any stack). |
| `openapi.yaml` | OpenAPI 3.1 spec for every `/api/v1` endpoint (request/response/error shapes). |
| `API_EXAMPLES.md` | Concrete request/response JSON for each call, seeded from the mock. |

## Seeds — already grounded in the mock
- **Belts:** `BELTS` in `reference/dojo-core.jsx` — white·A1, yellow·A2, orange·B1, green·B2, blue·C1, black·C2.
- **Topics / exercises / achievements:** `TOPICS`, `BUILD`, `ACHIEVEMENTS` in the same file.
- **Proverbs:** `KOTOWAZA` / `KOTOWAZA_GOLD`. ⚠️ Not present in this `reference/` set (the brief points at
  `dojo-extras.jsx`); pull the real deck from the app's source before seeding. `API_EXAMPLES.md` shows the shape.

## Honest caveats before you build
1. **This mirrors the brief's GREENFIELD contract.** The repo already ships a **FastAPI** backend whose
   routes differ (`auth`, `profile`, `progress`, `contracts`, `cosmetics`, `events`, `wallet`, `agents` —
   no `/api/v1/home`, `/attempts`, `/practice/next`, `/topics`, `/lessons`, `/onboarding`, `/proverbs`,
   `/tts`). Decide up front: build the brief fresh, or map it onto the existing backend. Don't assume the
   `/api/v1` paths exist yet.
2. **`HANDOFF_v2.md` is referenced by the brief but isn't in this folder.** If the executor is a fresh
   agent, supply it or drop the reference.
3. **Voice (`GET /tts`) is Stage 4, gated on D7 retention** per the project's own roadmap — kept in the
   spec for completeness, but likely deferred.
