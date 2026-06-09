"""Password hashing (argon2id) and JWT access tokens (Phase 4)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from .config import settings

_ph = PasswordHasher()  # argon2id with sane defaults


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(subject: str) -> str:
    """Signed JWT whose `sub` is the user id; expires per JWT_EXPIRE_MIN."""
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.JWT_EXPIRE_MIN)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_token(token: str) -> str | None:
    """Return the subject (user id) if the token is valid & unexpired, else None."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("scope") == _VERIFY_SCOPE:
        return None  # an email-verification token must never authenticate a request
    sub = payload.get("sub")
    return str(sub) if sub else None


# --- email verification tokens (separate scope so they can't be used as access tokens) ---
_VERIFY_SCOPE = "verify"


def create_verify_token(subject: str) -> str:
    """Signed JWT for the activation link; `sub` = user id, scoped to verification, short-lived."""
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "scope": _VERIFY_SCOPE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.VERIFY_TOKEN_EXPIRE_H)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_verify_token(token: str) -> str | None:
    """Return the user id if this is a valid, unexpired verification token, else None."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("scope") != _VERIFY_SCOPE:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None
