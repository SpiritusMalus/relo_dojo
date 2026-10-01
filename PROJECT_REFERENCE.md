# Reference notes

Preserved domain guidance from the previous CLAUDE.md. Historical deployment and status claims require verification. AGENTS.md and the existing ledger govern startup and current task state; old duplicated backlog/status prose is supporting history.

# Relo Dojo — project reference

This folder (`relo_dojo`) is the working root (code). The project's source of truth lives in the
Obsidian vault. **Read THIS file first — it routes you; don't auto-load vault files you don't need.**

## Vault location (folder renamed `mobile_app` → `Grammar Dojo` → `Relo Dojo`; flat layout since 2026-09-02)

All project docs live in:
`/Users/malum/myprojects/relo_dojo/.context/vault/Relo Dojo/` (all files directly in this folder, no subfolders)

| File | What's inside | Read when |
|---|---|---|
| `HANDOFF_app.md` | **Hub**: idea, stack, key constraints, **Current Status**, index | **Always first** when starting real work |
| `BACKLOG.md` | Running task list (done + open), decisions log | Picking up / adding / finishing a task — almost every working session |
| `PRAKTIKA_ADOPTION_PLAN.md` | **North star**: vision (free-text goal → adaptive account), verified Praktika analysis, locked decisions | Before touching anything in the BACKLOG "Praktika adoption" section; whenever product direction is in question |
| `ARCHITECTURE.md` | Stack rationale, endpoint flow, repo layout, standards, costs | Only when the task changes backend structure, endpoints, or stack — NOT needed for routine feature work (repo layout is also discoverable from code) |
| `PHASES.md` | Phases 0–8, goals + done-criteria | Only when phase scope/done-criteria matter |
| `MONETIZATION_PLAN.md` | Dojo economy canon (koku/omamori/kensei naming), payment plans Phase 7/8 | Only for economy/paywall/copy work |
| `NICHE_PIVOT_IT_RELOCATION.md` | Niche wedge "English for IT relocation": decision, why-cheap, tasks, file pointers | When implementing the IT-relocation positioning / onboarding work |
| `!CLAUDE-CODE_HUB.md` | Obsidian wiki-link index **for the user's graph** | Never needed by Claude; keep its links fresh when files are added/removed |

Typical routing: task work → `HANDOFF_app.md` (status) → `BACKLOG.md` (the task) → open
`ARCHITECTURE.md` only if the task touches backend structure / endpoints / standards.

## Key locked decisions (don't re-litigate; details in PRAKTIKA_ADOPTION_PLAN.md)

- App is for **any field** (dev-only niche dropped 2026-06-11; "any sphere" pivot shipped).
- **Prod LLM = API (Claude/OpenAI)**, decided 2026-06-11; Ollama = local dev only.
- No video avatars. Voice (TTS→STT) required but staged, gated on D7 retention.
- North-star metric: **Day-7 retention**.

## Trigger: "обнови хаб" ("update the hub")

When the user says **«обнови хаб»**, refresh the hub set in the vault folder above:

- Keep `HANDOFF_app.md` small and dense; update **Current Status** there.
- Record open questions and new tasks in `BACKLOG.md`; touch only the affected files.
- Write in **clean, dense English markdown** — token-efficient, no fluff, no duplication,
  without losing meaning.
- Delete files that lost their value (fold any still-useful content into the survivors first),
  and update the file table above + `!CLAUDE-CODE_HUB.md` index when files are added/removed.

## Working agreement

End every working session by updating Current Status in `HANDOFF_app.md` and logging new items in
`BACKLOG.md`. Conversation language: Russian; all project/vault documents: English. Every task =
its own branch from `main`; push and merge into main when done.
