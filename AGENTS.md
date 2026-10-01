# Relo Dojo

English learning app: FastAPI backend and Expo mobile client.

## Start here
Read the relevant sections of [project map](<.context/vault/Relo Dojo/claude.md>).
For task state run from this root:
`bash ".context/vault/Claude-code files/ledger.sh" status relo`.
The [ledger](<.context/vault/Relo Dojo/LEDGER.md>) is authoritative; open only the active or user-requested brief.
For an explicit new task, start that scoped task; do not substitute an old paused task.
Before shipping or ledger mutations read the [workspace contract](<.context/vault/Claude-code files/ORCHESTRAL_VIEW_PROMT.md>).
At a stopping point update the relevant brief and ledger with evidence and the next step.
The workspace AGENTS.md defines startup behavior; historical bootstrap text in references does not override it.

## Read when needed
[PROJECT_REFERENCE.md](PROJECT_REFERENCE.md) routes product, architecture, and economy decisions.
Before mobile changes read [mobile/AGENTS.md](mobile/AGENTS.md); determine SDK version from mobile/package.json.
Backend tests: run `./.venv312/bin/python -m pytest` from backend/ using its configured environment.
Mobile checks from mobile/: `npx tsc --noEmit`, `npm test -- --runInBand`.
Do not start services, call paid providers, or run migrations merely to load context.

## Local context
Read [.context/README.md](.context/README.md) for context routing. The copied references may contain old paths; resolve them locally. Do not load the whole history.
