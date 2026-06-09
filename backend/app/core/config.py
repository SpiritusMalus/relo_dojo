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
