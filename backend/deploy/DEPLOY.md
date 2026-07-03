# relo_dojo backend — deploy to the family-pie VPS (`relo.family-pie.ru`)

Co-locates the FastAPI backend on the existing shared VPS (`fam` → `root@103.246.144.198`, NL)
next to family-pie (static) and HealthRoutine (food proxy, systemd `healthroutine-food.service`,
`127.0.0.1:8787`). **Nothing here touches those services** — relo gets its own user, its own
localhost port (`127.0.0.1:8010`), its own Postgres DB, and one ADD-ONLY block in the shared
Caddyfile.

Files in this dir: [`relo-dojo.service`](relo-dojo.service) (systemd unit) ·
[`Caddyfile.relo.snippet`](Caddyfile.relo.snippet) (Caddy block, incl. RD-08 proxy headers) ·
[`.env.prod.example`](.env.prod.example) (prod env template).

> **Owner prerequisites:** DNS `relo.family-pie.ru` → `103.246.144.198` (A record). If
> `family-pie.ru` is on a wildcard/managed zone that already covers subdomains, this may resolve
> already — verify with `dig +short relo.family-pie.ru` before Caddy tries to issue a cert.

---

## 1. Code onto the box
```bash
ssh fam
# Unprivileged service user (no login shell, no home clutter).
id relo >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin relo
git clone https://github.com/SpiritusMalus/relo_dojo.git /opt/relo_dojo || \
  (cd /opt/relo_dojo && git fetch origin main && git checkout main && git pull --ff-only)
chown -R relo:relo /opt/relo_dojo
```

## 2. PostgreSQL (new on this box; HR uses SQLite, family-pie is static)
```bash
apt-get update && apt-get install -y postgresql
systemctl enable --now postgresql
# Strong password — generate and keep it for the DATABASE_URL below.
DB_PW=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))"); echo "DB_PW=$DB_PW"
sudo -u postgres psql -c "CREATE USER relo WITH PASSWORD '$DB_PW';"
sudo -u postgres psql -c "CREATE DATABASE relo_dojo OWNER relo;"
```

## 3. Python venv + deps (Python ≥3.10 — app uses PEP 604 unions)
```bash
apt-get install -y python3-venv
sudo -u relo python3 -m venv /opt/relo_dojo/backend/.venv
sudo -u relo /opt/relo_dojo/backend/.venv/bin/pip install -U pip
sudo -u relo /opt/relo_dojo/backend/.venv/bin/pip install -r /opt/relo_dojo/backend/requirements.txt
```

## 4. Prod `.env`
```bash
cp /opt/relo_dojo/backend/deploy/.env.prod.example /opt/relo_dojo/backend/.env
# Fill the markers:
#   JWT_SECRET   = python3 -c "import secrets; print(secrets.token_urlsafe(48))"
#   CHECK_SECRET = .venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   DATABASE_URL = ...://relo:<DB_PW>@127.0.0.1:5432/relo_dojo   (DB_PW from step 2)
#   OPENROUTER_API_KEY = sk-or-v1-...  (the account MUST have purchased credits, else HTTP 402)
#   SMTP_PASSWORD = the relo@family-pie.ru mailbox password (from reg.ru ISPmanager)
chown relo:relo /opt/relo_dojo/backend/.env && chmod 600 /opt/relo_dojo/backend/.env
# Confirm the LLM + voice links are live before going public (no DB/server needed):
sudo -u relo /opt/relo_dojo/backend/.venv/bin/python /opt/relo_dojo/backend/scripts/verify_llm.py
sudo -u relo /opt/relo_dojo/backend/.venv/bin/python /opt/relo_dojo/backend/scripts/verify_voice.py
```

## 5. systemd service (migrations auto-run on first start via AUTO_MIGRATE=true)
```bash
cp /opt/relo_dojo/backend/deploy/relo-dojo.service /etc/systemd/system/relo-dojo.service
systemctl daemon-reload
systemctl enable --now relo-dojo.service
systemctl status relo-dojo.service --no-pager      # active (running)?
curl -fsS http://127.0.0.1:8010/health             # {"status":"ok"} — local before public
```

## 6. Caddy (ADD a block — never overwrite the shared Caddyfile)
```bash
# Append the relo block; the family-pie / food blocks stay as-is.
cat /opt/relo_dojo/backend/deploy/Caddyfile.relo.snippet >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile        # MUST pass before reload
systemctl reload caddy                              # graceful — does not drop family-pie/food
```

## 7. Verify over HTTPS (cert issues on first hit; allow ~30s)
```bash
curl -fsS https://relo.family-pie.ru/health         # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}" https://relo.family-pie.ru/auth/me   # 401 (no token) = auth wired
# Hardening checks from the audit:
curl -sI https://relo.family-pie.ru/health | grep -i strict-transport       # HSTS present (RD-08)
curl -s -o /dev/null -w "%{http_code}" https://relo.family-pie.ru/docs       # 404 (Swagger off, RD-07)
```

## 8. Point the app at prod & continue the deploy brief
Set `EXPO_PUBLIC_API_URL=https://relo.family-pie.ru` in `mobile/` (deploy brief step 6), then the
EAS build/submit steps (7–9). Backend being reachable over HTTPS is the precondition for store review.

---

### Rollback (relo only — neighbours unaffected)
```bash
systemctl disable --now relo-dojo.service
# remove the appended relo.family-pie.ru block from /etc/caddy/Caddyfile, then:
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
# optional: sudo -u postgres psql -c "DROP DATABASE relo_dojo;" -c "DROP USER relo;"
```

### Notes
- **`Environment=HOME=/opt/relo_dojo/backend` in the unit is load-bearing (not cosmetic).** asyncpg
  probes `~/.postgresql/postgresql.key` during SSL negotiation; with `ProtectHome=true` the masked
  `/home/relo` makes that `stat()` raise `PermissionError`, so **every DB endpoint (register/login/…)
  500s** while non-DB routes (`/health`, `/billing/plans`) still 200 — a confusing partial outage. The
  unit sets `HOME` to an unmasked dir so the probe finds nothing and the connection proceeds; TLS and
  ProtectHome stay on. If you ever see DB-only 500s on this box, check that line first.
- **Audit follow-up:** the family-pie VPS `sshd` still has `PasswordAuthentication yes` +
  `PermitRootLogin yes` (flagged in the studio security audit, owner/infra fix — out of scope for
  this deploy, but worth hardening while you're on the box).
- **LLM + voice = OpenRouter (one `sk-or` key).** `LLM_PROVIDER=openrouter`, model
  `google/gemini-3.1-flash-lite` for both text and read-aloud `/voice/transcribe` (it accepts audio
  input). The OpenRouter account **must have purchased credits** or every LLM/voice call returns
  **HTTP 402 "Insufficient credits"** (the model is paid) — top up at openrouter.ai/settings/credits.
  **Set `OPENROUTER_REASONING_EFFORT=none`** (in .env, then restart): Gemini 3.x thinks by default,
  which is ~10s instead of ~1.5s per exercise card and 6x-priced reasoning tokens for zero quality
  gain on these tiny structured calls. A per-request **403** from OpenRouter is a moderation/guardrail
  flag or key permissions, NOT a bad key — since the error-mapping fix the journald line
  (`llm error ... body=...`) and the app's 503 detail carry OpenRouter's own reason; also check
  openrouter.ai/activity.
  Verify both links with `scripts/verify_llm.py` + `scripts/verify_voice.py`. Until the key is set
  (and funded), the LLM-backed endpoints (`/exercise`, `/story`, `/check-answer`, `/explain`,
  `/review-text`, `/profile/analyze`, `/agent/*`, `/voice/transcribe`) 503/502; everything else works.
- **Voice scope:** read-aloud pronunciation only. Realtime **Live dialog is NOT available on
  OpenRouter** — only the `gemini` provider (direct Google `AIza` key) has it, and that path is
  currently dropped. `VOICE_ENABLED=true` exposes `/voice/transcribe`; `/voice/live-token` will 502.
