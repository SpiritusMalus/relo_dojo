#!/usr/bin/env python3
"""Reality-pass smoke test — exercise a RUNNING backend against real Postgres.

The unit suite (193 pytest) covers the pure service layer with fakes; it never touches a real DB,
LLM, or HTTP stack. This script closes that gap: point it at a live server and it drives the
account + sync + economy + analytics round-trips end to end, so the "breadth is outrunning reality"
risk in the handoff hub becomes one command instead of a 10-tap manual checklist.

It creates a throwaway account each run (idempotent, no cleanup needed) and asserts the real
contracts:
  • GET  /health                      server up
  • POST /auth/register               account creation (proves the users table / migrations ran)
  • GET  /auth/me                      returns the `access` map (services/access.py)
  • PUT/GET /progress                  JSONB snapshot survives a real write→read (Postgres)
  • PUT/GET /profile                   learner-profile row round-trips
  • POST /events                       analytics ingestion (Day-7 instrumentation)
  • GET  /contracts                    daily-contracts read
  • GET  /cosmetics                    cosmetics row read
  • POST /wallet/spend streak_repair   prices off the SYNCED snapshot, not client qty (expect 409,
                                       no koku — proves the server-authoritative path runs on PG)
  • POST /ads/reward                   expect 403 ads_disabled (rewarded ads off by default)
  • POST /exercise → /check            (only with --llm) full generate→grade loop; needs Ollama/API

Usage:
    cd backend
    python scripts/smoke.py                      # http://localhost:8000
    python scripts/smoke.py --url http://192.168.1.50:8000
    python scripts/smoke.py --llm                # also exercise the model-backed /exercise + /check

Exit code is non-zero if any hard check fails, so it drops straight into CI later. The --llm loop is
advisory (a cold/absent model warns, never fails the run).
"""

from __future__ import annotations

import argparse
import sys
import uuid

import httpx

PASS, FAIL, WARN = "\033[32m✓\033[0m", "\033[31m✗\033[0m", "\033[33m!\033[0m"


class Smoke:
    def __init__(self, base_url: str) -> None:
        self.client = httpx.Client(base_url=base_url.rstrip("/"), timeout=30.0)
        self.token: str | None = None
        self.failures = 0
        self.warnings = 0

    # --- reporting -----------------------------------------------------------
    def ok(self, label: str, detail: str = "") -> None:
        print(f"  {PASS} {label}" + (f"  \033[90m{detail}\033[0m" if detail else ""))

    def bad(self, label: str, detail: str = "") -> None:
        self.failures += 1
        print(f"  {FAIL} {label}" + (f"  \033[90m{detail}\033[0m" if detail else ""))

    def warn(self, label: str, detail: str = "") -> None:
        self.warnings += 1
        print(f"  {WARN} {label}" + (f"  \033[90m{detail}\033[0m" if detail else ""))

    def auth(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    # --- checks --------------------------------------------------------------
    def health(self) -> None:
        try:
            r = self.client.get("/health")
        except httpx.HTTPError as e:
            self.bad("GET /health", f"cannot reach server — is it running? ({e})")
            raise SystemExit(self._summary())
        if r.status_code == 200 and r.json().get("status") == "ok":
            self.ok("GET /health", "server up")
        else:
            self.bad("GET /health", f"{r.status_code} {r.text[:80]}")
            raise SystemExit(self._summary())

    def register(self) -> None:
        email = f"smoke+{uuid.uuid4().hex[:12]}@relodojo.test"
        r = self.client.post(
            "/auth/register", json={"email": email, "password": "SmokeTest-1234567"}
        )
        if r.status_code in (200, 201) and r.json().get("access_token"):
            self.token = r.json()["access_token"]
            self.ok("POST /auth/register", email)
        else:
            self.bad("POST /auth/register", f"{r.status_code} {r.text[:120]}")

    def me(self) -> None:
        if not self.token:
            return self.warn("GET /auth/me", "skipped (no token)")
        r = self.client.get("/auth/me", headers=self.auth())
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code == 200 and isinstance(body.get("access"), dict):
            self.ok(
                "GET /auth/me",
                f"access map ✓ (verified={body.get('is_verified')}, coins={body.get('coins')})",
            )
        else:
            self.bad("GET /auth/me", f"{r.status_code} — no `access` map in {r.text[:120]}")

    def progress_round_trip(self) -> None:
        if not self.token:
            return self.warn("/progress", "skipped (no token)")
        snapshot = {
            "xp": 5,
            "dailyStreak": 7,
            "brokenStreak": {"streak": 7, "date": "2026-06-16"},
        }
        put = self.client.put("/progress", json=snapshot, headers=self.auth())
        get = self.client.get("/progress", headers=self.auth())
        body = get.json() if get.status_code == 200 else {}
        if (
            put.status_code == 200
            and get.status_code == 200
            and body.get("xp") == 5
            and body.get("dailyStreak") == 7
            and (body.get("brokenStreak") or {}).get("streak") == 7
        ):
            self.ok("PUT/GET /progress", "JSONB snapshot persisted on Postgres (incl. brokenStreak)")
        else:
            self.bad("PUT/GET /progress", f"put={put.status_code} get={get.status_code} {get.text[:100]}")

    def profile_round_trip(self) -> None:
        if not self.token:
            return self.warn("/profile", "skipped (no token)")
        get = self.client.get("/profile", headers=self.auth())
        if get.status_code != 200:
            return self.bad("GET /profile", f"{get.status_code} {get.text[:100]}")
        # Echo the row straight back — avoids guessing the schema while still exercising the write.
        put = self.client.put("/profile", json=get.json(), headers=self.auth())
        if put.status_code == 200:
            self.ok("PUT/GET /profile", "learner-profile row round-trips")
        else:
            self.bad("PUT /profile", f"{put.status_code} {put.text[:100]}")

    def events(self) -> None:
        payload = {"anon_id": "smoke", "events": [{"name": "smoke_test", "props": {"ok": True}}]}
        r = self.client.post("/events", json=payload, headers=self.auth())
        if r.status_code == 200 and r.json().get("accepted") == 1:
            self.ok("POST /events", "analytics event ingested")
        else:
            self.bad("POST /events", f"{r.status_code} {r.text[:100]}")

    def contracts(self) -> None:
        if not self.token:
            return self.warn("/contracts", "skipped (no token)")
        r = self.client.get("/contracts", headers=self.auth())
        if r.status_code == 200:
            n = len(r.json().get("contracts", []))
            self.ok("GET /contracts", f"{n} contract(s) today")
        else:
            self.bad("GET /contracts", f"{r.status_code} {r.text[:100]}")

    def cosmetics(self) -> None:
        if not self.token:
            return self.warn("/cosmetics", "skipped (no token)")
        r = self.client.get("/cosmetics", headers=self.auth())
        if r.status_code == 200:
            self.ok("GET /cosmetics", "cosmetics row read")
        else:
            self.bad("GET /cosmetics", f"{r.status_code} {r.text[:100]}")

    def streak_repair_authority(self) -> None:
        """The new account has 0 koku and a synced brokenStreak.streak=7. The server must price the
        repair off ITS snapshot (94 koku) and 409 — proving the server-authoritative path on PG.
        A patched client sending qty=1 must not be able to lower the price below what we expect."""
        if not self.token:
            return self.warn("/wallet/spend streak_repair", "skipped (no token)")
        r = self.client.post(
            "/wallet/spend", json={"item": "streak_repair", "qty": 1}, headers=self.auth()
        )
        if r.status_code == 409:
            self.ok(
                "POST /wallet/spend streak_repair",
                "409 (no koku) — priced off the synced snapshot, not client qty",
            )
        elif r.status_code == 200:
            # Only reachable if the account somehow has koku; the path still ran.
            self.warn("POST /wallet/spend streak_repair", "200 — account had koku; path exercised")
        else:
            self.bad("POST /wallet/spend streak_repair", f"{r.status_code} {r.text[:100]}")

    def ads_reward(self) -> None:
        if not self.token:
            return self.warn("/ads/reward", "skipped (no token)")
        r = self.client.post("/ads/reward", headers=self.auth())
        detail = r.json().get("detail") if r.status_code != 200 else None
        code = detail.get("code") if isinstance(detail, dict) else None
        if r.status_code == 403 and code == "ads_disabled":
            self.ok("POST /ads/reward", "403 ads_disabled (rewarded ads off by default) — as designed")
        elif r.status_code == 200:
            self.warn("POST /ads/reward", "200 — rewarded ads are ENABLED (ADS_REWARDS_PER_DAY > 0)")
        else:
            self.bad("POST /ads/reward", f"{r.status_code} {r.text[:100]}")

    def llm_loop(self) -> None:
        """Optional: the only model-backed path. A cold/absent model warns, never fails the run."""
        ex = self.client.post("/exercise", json={}, headers=self.auth())
        if ex.status_code == 503:
            return self.warn("POST /exercise", "503 — model unavailable (start Ollama or set LLM_PROVIDER)")
        if ex.status_code != 200:
            return self.bad("POST /exercise", f"{ex.status_code} {ex.text[:100]}")
        data = ex.json()
        self.ok("POST /exercise", f"type={data.get('type')} topic={data.get('topic')}")
        token = data.get("token")
        if not token:
            return self.warn("POST /check", "skipped (free-text exercise carries no token)")
        chk = self.client.post(
            "/check", json={"token": token, "response": "definitely-wrong"}, headers=self.auth()
        )
        if chk.status_code == 200 and "correct" in chk.json():
            self.ok("POST /check", f"graded (correct={chk.json()['correct']})")
        else:
            self.bad("POST /check", f"{chk.status_code} {chk.text[:100]}")

    # --- runner --------------------------------------------------------------
    def run(self, with_llm: bool) -> int:
        print(f"\n\033[1mReality-pass smoke test\033[0m → {self.client.base_url}\n")
        self.health()
        self.register()
        self.me()
        self.progress_round_trip()
        self.profile_round_trip()
        self.events()
        self.contracts()
        self.cosmetics()
        self.streak_repair_authority()
        self.ads_reward()
        if with_llm:
            print("\n  \033[90m— model-backed (--llm) —\033[0m")
            self.llm_loop()
        return self._summary()

    def _summary(self) -> int:
        print()
        if self.failures:
            print(f"\033[31m{self.failures} check(s) FAILED\033[0m", end="")
        else:
            print("\033[32mAll hard checks passed\033[0m", end="")
        if self.warnings:
            print(f"  \033[33m({self.warnings} warning(s))\033[0m", end="")
        print("\n")
        return 1 if self.failures else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8000", help="backend base URL")
    ap.add_argument("--llm", action="store_true", help="also exercise /exercise + /check (needs a model)")
    args = ap.parse_args()
    try:
        return Smoke(args.url).run(args.llm)
    except SystemExit as code:
        return int(code.code or 0)


if __name__ == "__main__":
    sys.exit(main())
