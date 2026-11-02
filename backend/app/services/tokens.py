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

import base64
import hashlib
import hmac
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
        except (ValueError, TypeError) as exc:
            # Set but malformed = operator error. Fail loudly at startup (like the required
            # DATABASE_URL / JWT_SECRET) instead of silently degrading to an ephemeral key. That key
            # differs per process, so under a multi-worker / multi-instance deploy a token sealed by
            # one worker cannot be unsealed by another, and /check would fail unpredictably.
            raise RuntimeError(
                "CHECK_SECRET is set but is not a valid Fernet key (expected 32 url-safe base64 "
                "bytes - generate one with `Fernet.generate_key()`)."
            ) from exc
    if settings.is_prod:
        # An ephemeral per-process key breaks /check across restarts and (multi-worker) instances:
        # a token sealed by one worker can't be unsealed by another. Required in prod like JWT_SECRET.
        raise RuntimeError(
            "CHECK_SECRET is required when ENV=prod (an ephemeral key breaks /check across restarts "
            "and workers). Generate one with `Fernet.generate_key()`."
        )
    return Fernet(Fernet.generate_key())


_fernet = _build_fernet()
CHAPTER_TOKEN_PREFIX = "chapter-v1:"


def _build_chapter_fernet() -> Fernet:
    """Separate key domain: removing the wire prefix cannot make a chapter token ordinary."""
    if CHECK_SECRET:
        key = hmac.new(CHECK_SECRET.encode(), b"relo-dojo/chapter/v1", hashlib.sha256).digest()
        return Fernet(base64.urlsafe_b64encode(key))
    return Fernet(Fernet.generate_key())  # independent ephemeral dev key, like ordinary tokens


_chapter_fernet = _build_chapter_fernet()


def seal(data: dict[str, Any]) -> str:
    """Encrypt a small dict into an opaque token string."""
    chapter_purpose = "_chapter" in data or "_chapter_review_owner" in data
    cipher = _chapter_fernet if chapter_purpose else _fernet
    encoded = cipher.encrypt(json.dumps(data).encode()).decode()
    # The wire prefix selects the isolated key domain. Even a stripped chapter ciphertext is
    # invalid for the preceding release's ordinary Fernet key.
    return CHAPTER_TOKEN_PREFIX + encoded if chapter_purpose else encoded


def unseal(token: str) -> dict[str, Any]:
    """Decrypt a token back into its dict. Raises TokenError on any failure."""
    try:
        prefixed = token.startswith(CHAPTER_TOKEN_PREFIX)
        encoded = token[len(CHAPTER_TOKEN_PREFIX):] if prefixed else token
        cipher = _chapter_fernet if prefixed else _fernet
        ttl = settings.EXERCISE_TOKEN_TTL_S or None  # 0 → no expiry
        # Authenticate before selecting the purpose-specific lifetime. Ordinary exercise tokens
        # retain the configured TTL; only our owner-bound review tokens cover the SRS 21-day gap.
        raw = cipher.decrypt(encoded.encode())
        peek = json.loads(raw)
        chapter_purpose = isinstance(peek, dict) and ("_chapter" in peek or "_chapter_review_owner" in peek)
        if prefixed != chapter_purpose:
            raise InvalidToken
        if isinstance(peek, dict) and (
            (peek.get("_dojo_review_v") == 1 and peek.get("_dojo_review_owner")) or
            (peek.get("_chapter_review_v") == 1 and peek.get("_chapter_review_owner"))
        ):
            ttl = 35 * 86400
        raw = cipher.decrypt(encoded.encode(), ttl=ttl)
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise TokenError("This exercise has expired. Fetch a new one.") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # pragma: no cover - sealed by us, shouldn't happen
        raise TokenError("Corrupt exercise token.") from exc
    if not isinstance(data, dict):  # pragma: no cover
        raise TokenError("Corrupt exercise token.")
    return data
