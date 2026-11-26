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
import time
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from ..core.config import CHECK_SECRET, settings


class TokenError(Exception):
    """Raised when a token can't be used (invalid, malformed or expired)."""


class ReviewScopeError(TokenError):
    """A valid review token belongs to a different learner."""


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
STUDY_TOKEN_PREFIX = "study-v1:"


def _domain_fernet(domain: bytes) -> Fernet:
    """Keep capability tokens out of the ordinary grading and reward key domain."""
    if CHECK_SECRET:
        key = hmac.new(CHECK_SECRET.encode(), domain, hashlib.sha256).digest()
        return Fernet(base64.urlsafe_b64encode(key))
    return Fernet(Fernet.generate_key())  # independent ephemeral dev key


def _build_chapter_fernet() -> Fernet:
    return _domain_fernet(b"relo-dojo/chapter/v1")


_chapter_fernet = _build_chapter_fernet()
_study_fernet = _domain_fernet(b"relo-dojo/study-review/v1")


def _token_domain(data: dict[str, Any]) -> str:
    if "_study_review" in data:
        return STUDY_TOKEN_PREFIX
    if "_chapter" in data or "_chapter_review_owner" in data:
        return CHAPTER_TOKEN_PREFIX
    return ""


def _cipher_for(prefix: str) -> Fernet:
    if prefix == STUDY_TOKEN_PREFIX:
        return _study_fernet
    if prefix == CHAPTER_TOKEN_PREFIX:
        return _chapter_fernet
    return _fernet


def seal(data: dict[str, Any]) -> str:
    """Encrypt a small dict into an opaque token string."""
    prefix = _token_domain(data)
    return prefix + _cipher_for(prefix).encrypt(json.dumps(data).encode()).decode()


_REVIEW_TTL = 180 * 86400
_REVIEW_RENEWAL_LIMIT = 365 * 86400


def _review_scope(user_id: str | None, guest_id: str | None) -> str | None:
    if user_id is not None:
        return f"user:{user_id}"
    if guest_id is not None and 12 <= len(guest_id) <= 128 and guest_id.isascii():
        return f"guest:{hashlib.sha256(guest_id.encode()).hexdigest()}"
    return None


def _signed_review_scope(data: dict[str, Any]) -> str | None:
    scoped = data.get("_study_review")
    if isinstance(scoped, str) and scoped:
        return scoped
    for mode in ("dojo", "chapter"):
        owner = data.get(f"_{mode}_review_owner")
        if data.get(f"_{mode}_review_v") == 1 and isinstance(owner, str) and owner:
            return f"user:{owner}"
    return None


def _unseal(token: str, *, for_renewal: bool = False) -> dict[str, Any]:
    try:
        prefix = next((candidate for candidate in (STUDY_TOKEN_PREFIX, CHAPTER_TOKEN_PREFIX)
                       if token.startswith(candidate)), "")
        encoded = token[len(prefix):].encode()
        cipher = _cipher_for(prefix)
        # Authenticate before selecting a lifetime or accepting an embedded learner scope.
        data = json.loads(cipher.decrypt(encoded))
        if not isinstance(data, dict) or _token_domain(data) != prefix:
            raise InvalidToken
        review_scope = _signed_review_scope(data)
        if for_renewal:
            if review_scope is None:
                raise InvalidToken
            ttl = _REVIEW_RENEWAL_LIMIT
        elif "_study_review" in data and review_scope is not None:
            ttl = _REVIEW_TTL
        elif review_scope is not None:
            ttl = 35 * 86400
        else:
            ttl = settings.EXERCISE_TOKEN_TTL_S or None  # 0 → no expiry
        cipher.decrypt(encoded, ttl=ttl)
        if for_renewal:
            issued = int(cipher.extract_timestamp(encoded))
            born = data.get("_study_born", issued)
            if type(born) is not int or born > issued or int(time.time()) - born > _REVIEW_RENEWAL_LIMIT:
                raise InvalidToken
            data["_study_born"] = born
    except (InvalidToken, ValueError, TypeError) as exc:
        raise TokenError("This exercise has expired. Fetch a new one.") from exc
    return data


def unseal(token: str) -> dict[str, Any]:
    """Decrypt a token using the lifetime for its signed purpose."""
    return _unseal(token)


def _study_token(data: dict[str, Any], scope: str, born: int) -> str:
    # Preserve the signed grade key and remove all original session, chapter or wallet claims.
    grading_data = {key: value for key, value in data.items() if not key.startswith("_")}
    return seal({**grading_data, "_study_review": scope, "_study_born": born})


def attach_review_token(
    exercise: dict[str, Any], user_id: str | None, guest_id: str | None
) -> dict[str, Any]:
    """Attach a longer-lived, study-only copy of a newly issued exercise."""
    scope = _review_scope(user_id, guest_id)
    token = exercise.get("token")
    if scope is None or not token or exercise.get("review_token"):
        return exercise
    return {**exercise, "review_token": _study_token(unseal(token), scope, int(time.time()))}


def validate_review(data: dict[str, Any], user_id: str | None, guest_id: str | None) -> bool:
    """Validate study replays before grading; False means the normal check path applies."""
    if "_study_review" not in data:
        return False
    scope = _review_scope(user_id, guest_id)
    original = _signed_review_scope(data)
    if scope is None or original is None or not hmac.compare_digest(scope, original):
        raise ReviewScopeError("This review item belongs to another learner.")
    return True


def renew_review_token(token: str, user_id: str | None, guest_id: str | None) -> str:
    """Recover an older scoped review card without granting ordinary exercise privileges."""
    data = _unseal(token, for_renewal=True)
    scope = _review_scope(user_id, guest_id)
    original = _signed_review_scope(data)
    if scope is None or original is None or not hmac.compare_digest(scope, original):
        raise ReviewScopeError("This review item belongs to another learner.")
    return _study_token(data, scope, data["_study_born"])
