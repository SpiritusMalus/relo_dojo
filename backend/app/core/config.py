"""App configuration — typed, validated, loaded from environment / .env (pydantic-settings).

Production-first: required secrets (DATABASE_URL, JWT_SECRET) have no defaults, so the app fails
fast at startup if they are missing. Module-level aliases are kept for existing imports
(ollama_client, grammar, tokens) so nothing else has to change.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Ollama (Phase 1+) ---
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
    # Shop prices, in koku.
    PRICE_OMAMORI: int = 150  # streak-freeze charm
    PRICE_EXTRA_PACK: int = 50  # +EXTRA_PACK_SIZE exercises for today (free tier)
    EXTRA_PACK_SIZE: int = 10
    # Streak repair ("отработка у Сэнсэя"): price grows with the LOST streak length (loss aversion
    # priced in — the more invested the user is, the dearer the rescue), capped at REPAIR_MAX.
    REPAIR_BASE: int = 100
    REPAIR_PER_DAY: int = 5
    REPAIR_MAX: int = 600

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
