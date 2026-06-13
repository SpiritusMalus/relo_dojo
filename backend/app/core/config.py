"""App configuration — typed, validated, loaded from environment / .env (pydantic-settings).

Production-first: required secrets (DATABASE_URL, JWT_SECRET) have no defaults, so the app fails
fast at startup if they are missing. Module-level aliases are kept for existing imports
(ollama_client, grammar, tokens) so nothing else has to change.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- LLM provider (API migration, decided 2026-06-11) ---
    # "ollama" (local dev, default) | "anthropic" | "openai". Prod runs on an API provider;
    # re-run the eval set (evals/run_eval.py --provider ...) before flipping this in prod.
    LLM_PROVIDER: str = "ollama"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-haiku-4-5"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    LLM_MAX_TOKENS: int = 1024  # API providers require an explicit cap

    # --- Ollama (local dev path) ---
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "gemma3:4b"
    EXERCISE_TEMPERATURE: float = 0.7
    CHECK_TEMPERATURE: float = 0.2

    # --- Interactive-exercise token sealing (Phase 2.5) ---
    # Fernet key; if empty an ephemeral key is generated per run (tokens won't survive a restart).
    CHECK_SECRET: str = ""

    # --- Accounts / DB (Phase 4) ---
    DATABASE_URL: str  # required, e.g. postgresql+asyncpg://user:pass@host/grammar_dojo
    JWT_SECRET: str  # required; sign/verify access tokens
    JWT_EXPIRE_MIN: int = 10080  # 7 days
    JWT_ALG: str = "HS256"
    # Comma-separated allowed CORS origins. Explicit on purpose — no "*" default in prod.
    ALLOWED_ORIGINS: str = ""

    # --- Email confirmation (account activation) ---
    # Base URL the verification link points at (the backend, e.g. https://api.grammardojo.ru). The
    # link is {APP_BASE_URL}/auth/verify?token=...; empty in dev → we log the link instead of erroring.
    APP_BASE_URL: str = ""
    VERIFY_TOKEN_EXPIRE_H: int = 24  # verification link lifetime, hours
    # Server-side gate: how many exercises an UNVERIFIED account may get per day (the "starter").
    # Stories are blocked entirely until verified. 0 = unverified users get no exercises.
    STARTER_DAILY_LIMIT: int = 15
    EMAIL_FROM: str = "dojo@grammardojo.ru"
    EMAIL_FROM_NAME: str = "Grammar Dojo"
    # SMTP transport. If SMTP_HOST is empty, email sending is disabled and the link is logged (dev).
    # For grammardojo.ru this is your mail provider's SMTP (e.g. Yandex 360 smtp.yandex.ru:465 SSL,
    # or Mail.ru biz smtp.mail.ru:465). Set SMTP_SSL=true for port 465, or keep STARTTLS for 587.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_SSL: bool = False  # True → implicit TLS (port 465); False → STARTTLS (port 587)

    # Daily exercise cap for VERIFIED free accounts (premium = unlimited). The squeeze point of the
    # free tier: hitting it at peak motivation is what sells extra packs and Black Belt.
    FREE_DAILY_LIMIT: int = 20

    # --- Economy (koku wallet) ---
    # Koku awarded per correct /check answer for authenticated users (server-authoritative;
    # variable bonus arrives with the variable-rewards branch).
    COIN_REWARD_CORRECT: int = 2
    # First-win-of-day bonus koku (engagement v2): a one-time daily anchor on the first correct
    # answer each UTC day — "come back daily" reward. 0 disables it.
    FIRST_WIN_BONUS: int = 10
    # Shop prices, in koku.
    PRICE_OMAMORI: int = 150  # streak-freeze charm
    PRICE_OMAMORI_PROMO: int = 75  # starter offer: half-price charm (24h client window)
    # Limit offer: double pack for the regular price (48h client window after first limit hit).
    # Promo windows are enforced client-side; the discounted item itself is harmless to keep open.
    PRICE_EXTRA_PACK: int = 50  # +EXTRA_PACK_SIZE exercises for today (free tier)
    EXTRA_PACK_SIZE: int = 10
    # Streak repair ("отработка у Сэнсэя"): price grows with the LOST streak length (loss aversion
    # priced in — the more invested the user is, the dearer the rescue), capped at REPAIR_MAX.
    # Softened curve (user decision 2026-06-10): growth keeps the loss-aversion pressure, the lower
    # cap avoids punishing the most loyal users hardest.
    REPAIR_BASE: int = 80
    REPAIR_PER_DAY: int = 2
    REPAIR_MAX: int = 300
    # Scroll rewards (variable reinforcement): how many scrolls an account may open per UTC day.
    SCROLLS_PER_DAY: int = 3
    # Minutes added to UTC before taking the calendar day for daily resets (exercise quota, scroll
    # cap). 0 = UTC (default). Set to the users' local offset so the daily limit and the client's
    # streak (which uses the LOCAL day) roll over together — e.g. 180 for MSK (UTC+3).
    DAY_OFFSET_MIN: int = 0

    # Sealed interactive-exercise tokens expire after this many seconds (defense-in-depth; also lets
    # the awarded-tokens dedup table be pruned safely past this age). 0 = no expiry. Generous so a
    # slow session never false-expires mid-answer.
    EXERCISE_TOKEN_TTL_S: int = 86400

    # Run `alembic upgrade head` automatically on backend startup, so the schema always matches
    # the code (single-instance deploys; disable if migrations are ever run by a pipeline).
    AUTO_MIGRATE: bool = True

    # Dev-only premium toggle: when true, POST /dev/premium flips the caller's Black Belt flag.
    # MUST stay false in prod — the real flag will be set by a payment provider (Phase 7/8).
    DEV_PREMIUM_TOGGLE: bool = False

    # Analytics readout gate: when true, GET /events/retention is exposed (404 otherwise).
    # Ingestion (POST /events) is always on — it's how we measure the north-star (D7 retention).
    ANALYTICS_ADMIN: bool = False

    # Events table TTL: rows older than this many days are purged on startup so the append-only
    # table can't grow unbounded. 0 = keep forever (default — opt in once retention math is dialed
    # in, so dev never loses cohort data by surprise). D7 only needs a few weeks of history.
    EVENTS_TTL_DAYS: int = 0

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()  # raises at startup if a required secret is missing

# Back-compat module-level aliases (used by ollama_client.py, grammar.py, tokens.py).
OLLAMA_URL = settings.OLLAMA_URL
OLLAMA_MODEL = settings.OLLAMA_MODEL
EXERCISE_TEMPERATURE = settings.EXERCISE_TEMPERATURE
CHECK_TEMPERATURE = settings.CHECK_TEMPERATURE
CHECK_SECRET = settings.CHECK_SECRET
