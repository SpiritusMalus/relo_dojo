"""Sealed tokens for interactive exercises (Phase 2.5).

Interactive exercises (build-the-sentence, match-pairs, tap-the-error, multiple-choice) have
deterministic answers, so the LLM is not needed to grade them. To keep the correct answer
server-side (handoff standard: never ship the answer to the client) while staying **stateless**
(no DB until Phase 4), `/exercise` seals the answer into an encrypted token the client echoes back
to `/check`. The server unseals, grades in Python, and only then may reveal the answer.

Fernet gives authenticated symmetric encryption: the client can neither read nor tamper with the
payload. The key comes from CHECK_SECRET (.env); if unset we generate an ephemeral key at startup —
zero-config for dev. Tokens are short-lived (one exercise), so a server restart simply invalidates
in-flight tokens and `/check` returns a clean "expired" error.
"""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from ..core.config import CHECK_SECRET, settings


class TokenError(Exception):
    """Raised when a token can't be unsealed (tampered, malformed, or expired by key rotation)."""


# A valid Fernet key is 32 url-safe-base64 bytes. Use the configured secret if it is one;
# otherwise derive/generate. An ephemeral key means tokens last only for this process lifetime,
# which is exactly what we want for one-shot exercise tokens in dev.
def _build_fernet() -> Fernet:
    if CHECK_SECRET:
        try:
            return Fernet(CHECK_SECRET.encode())
        except (ValueError, TypeError):
            # Misconfigured key — fall through to an ephemeral one rather than crashing the server.
            pass
    return Fernet(Fernet.generate_key())


_fernet = _build_fernet()


def seal(data: dict[str, Any]) -> str:
    """Encrypt a small dict into an opaque token string."""
    return _fernet.encrypt(json.dumps(data).encode()).decode()


def unseal(token: str) -> dict[str, Any]:
    """Decrypt a token back into its dict. Raises TokenError on any failure."""
    try:
        ttl = settings.EXERCISE_TOKEN_TTL_S or None  # 0 → no expiry
        raw = _fernet.decrypt(token.encode(), ttl=ttl)
    except (InvalidToken, ValueError, TypeError) as exc:
        raise TokenError("This exercise has expired. Fetch a new one.") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # pragma: no cover - sealed by us, shouldn't happen
        raise TokenError("Corrupt exercise token.") from exc
    if not isinstance(data, dict):  # pragma: no cover
        raise TokenError("Corrupt exercise token.")
    return data
