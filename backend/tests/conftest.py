"""Test bootstrap.

`app.core.config` fails fast on missing required secrets (DATABASE_URL, JWT_SECRET) at import time,
so we set throwaway values here BEFORE any app module is imported. CHECK_SECRET is a fixed valid
Fernet key so sealed-token tests are deterministic within a run. No real DB/network is touched —
these tests cover the pure service layer (grading, tokens, story assembly).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/relo_dojo_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("CHECK_SECRET", "5s6wvK1N7CHNonLkBmfCVh5zC8iE5IQEIFD8wZyca8k=")
os.environ.setdefault("OLLAMA_URL", "http://localhost:11434")
