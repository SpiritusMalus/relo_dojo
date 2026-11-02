# Relo Dojo backend delivery

Current approved host: SSH alias `project-hub` (146.103.120.137).
Public endpoint: `https://relo.family-pie.ru`. Verify current routing before acting.
Historical server aliases are retired and must not be used.

| Target | Location / service |
|---|---|
| Running application | `/opt/relo_dojo/backend`, service user `relo` |
| Runtime unit | `relo-dojo.service`, loopback `127.0.0.1:8010` |
| Protected environment | `/opt/relo_dojo/backend/.env`, mode 0600 |
| Database | PostgreSQL `relo_dojo`; this release requires schema head `0020_practical_chapters` |
| Registered source replica | `/srv/projects/relo_dojo`, separate from runtime |

A source pull or hub bridge does not deploy the running process. Do not copy live
secrets/databases to source replicas, a laptop or another server. No Caddy change is
needed for an update on the existing endpoint. Other applications on the host are
outside this deployment.

## Release procedure

1. Follow the private project workflow: scoped review, green CI and a merged PR.
   Record the integrated SHA; require a clean runtime checkout and verify ancestry.
2. Before mutation, save a protected Git bundle, environment copy and consistent
   `pg_dump` on the same host under `/var/backups/relo-dojo/`. Record old SHA and
   dependency hashes. Preserve owner/mode; never print environment values.
3. Fast-forward `/opt/relo_dojo` to the exact integrated SHA through the existing
   authenticated Git route or a verified Git bundle. Install dependencies only if
   their files changed; run the runtime virtualenv's `pip check`.
4. Inspect Alembic head versus current. `0020_practical_chapters` follows
   `0019_dojo_practice` and adds chapter runs, issued preparation items and final
   attempt receipts. Final attempts retain a request hash and authored feedback,
   never the learner's submitted text. Back up first, then run the runtime virtualenv's Alembic upgrade as the
   application user. Use `AUTO_MIGRATE=false` so service restarts cannot silently
   change the schema. Never recreate the database or drop existing progress.
5. Set `RELO_RELEASE_SHA` to the integrated SHA. Enable `DOJO_ENABLED=true` only
   after migration and compatible API/client checks. The same capability gates
   `/dojo`, `/chapters` and chapter-bound `/check` items. Preserve model configuration,
   credentials, persistent token keys, mail, billing, audio and unrelated settings.
6. Restart only `relo-dojo.service`. Require active state, new PID/start time,
   localhost health and a successful read-only database/schema check.
7. Verify the public routes and a real client learning round trip. Record source
   SHA, process revision header, CI result and device artifact separately. Observe
   service errors and latency for at least 15 minutes; roll back promptly on a
   broken core flow rather than waiting out the window.
8. Reconcile the registered source replica with the Mac through the existing hub
   bridge, then update the private journal, canonical handoff and photo ZIP.

## Readiness checks

```sh
ssh project-hub 'systemctl is-active relo-dojo.service'
curl -fsS -D - https://relo.family-pie.ru/health
curl -s -o /dev/null -w '%{http_code}\n' https://relo.family-pie.ru/auth/me
curl -s -o /dev/null -w '%{http_code}\n' https://relo.family-pie.ru/docs
```

Expect health JSON `{"status":"ok"}`, `X-Relo-Revision` equal to the integrated
SHA, unauthenticated `/auth/me` 401 and production `/docs` 404. Health alone does
not verify PostgreSQL or model generation. Read diagnostics without exporting
provider headers, tokens or user content. A provider 403 can mean policy/model
permissions; repeated retries or weaker safety settings are not a content repair.

Rollback triggers: a core learning/auth flow fails, the process revision differs,
repeated 5xx appear, or the generation ladder exceeds its 60-second deadline.
Small synthetic latency samples are diagnostic; they are not a production SLA.

## Rollback

Restore the recorded previous code revision and only the relevant protected
configuration from the same-host backup; restart the Relo unit and repeat readiness
checks. Preserve the live database and user progress. Restoring an older database
or removing a service/proxy route is not a normal application rollback.

For My Dojo and practical chapters, disable `DOJO_ENABLED` first. Ordinary practice
remains available, including an in-flight ordinary lesson. Chapters and their
bound preparation checks return 404 while disabled; account export still includes
their saved evidence. Previously issued owner-bound review tokens remain usable
without creating chapter evidence or wallet rewards. Leave migrations 0019–0020 and all earned inventory in
place; their downgrades deliberately refuse to erase learning evidence. Older code
can ignore the additive tables with automatic migration disabled. Scoped review
tokens last 35 days; their durable economic identities are retained for 60 days.
Chapter preparation and review tokens use a separate `chapter-v1:` wire prefix
bound to their authenticated purpose and a distinct HMAC-derived Fernet key domain.
The preceding release rejects the chapter ciphertext even if its prefix is removed,
so a code rollback cannot reinterpret it as an ordinary koku-paying exercise. The
configured key derivation is stable across workers; ordinary token keys stay intact.
New code also rejects a stripped prefix or an ordinary token with that prefix.

Keep `Environment=HOME=/opt/relo_dojo/backend` in the service unit: under
`ProtectHome=true`, asyncpg otherwise may fail probing the masked home directory,
leaving DB endpoints broken while health remains green.

## Isolated acceptance

Task-owned QA uses a separate source root, database, signing secrets and loopback
port. Synthetic accounts may receive explicitly recorded currency fixtures; these
are not earned rewards or production grants. SMTP, payments and microphone voice
stay disabled in that sandbox. Its HTTP loopback APK is emulator-only. A delivered
APK must use the public HTTPS URL with the QA network exception removed.

For chapters, verify all three authored preparation steps through `/check`, an
incomplete final response and its correction, account isolation, final retry after
a lost response, and two concurrent submissions. Verify one chapter keepsake and
one UTC learning day across practice/chapter completion on the same day. No model
verdict grants koku, a belt or a CEFR level. Check actual PostgreSQL row locking;
the offline suite does not prove concurrent database behavior. Bound any real
model acceptance calls to synthetic text and the three released task rubrics.

See [the environment template](.env.prod.example) and
[the model evidence](../evals/MODEL_SELECTION.md). Never replace a populated runtime
`.env` with the template.
