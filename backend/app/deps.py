"""FastAPI dependencies: DB session per request + current-user resolution (Phase 4)."""

from __future__ import annotations

import uuid
from typing import AsyncIterator, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .core.config import settings
from .core.ratelimit import SlidingWindowLimiter
from .core.security import decode_token
from .db.base import SessionLocal
from .db.models import User

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated.",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None or not creds.credentials:
        raise _UNAUTHORIZED
    sub = decode_token(creds.credentials)
    if sub is None:
        raise _UNAUTHORIZED
    try:
        user_id = uuid.UUID(sub)
    except ValueError:
        raise _UNAUTHORIZED
    user = await db.get(User, user_id)
    if user is None:
        raise _UNAUTHORIZED
    return user


async def get_current_user_optional(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Resolve the user if a valid bearer token is present, else None (never raises).

    Used by public lesson endpoints that stay open to anonymous callers but apply per-account
    gating (starter quota / verification) when the request is authenticated."""
    if creds is None or not creds.credentials:
        return None
    sub = decode_token(creds.credentials)
    if sub is None:
        return None
    try:
        user_id = uuid.UUID(sub)
    except ValueError:
        return None
    return await db.get(User, user_id)


# --- rate limiting (abuse / cost guard) ------------------------------------------------------
# Two process-local buckets. Built once at import from settings; a limit of <= 0 disables a bucket.
_auth_limiter = SlidingWindowLimiter(settings.AUTH_RATE_LIMIT, settings.AUTH_RATE_WINDOW_S)
_llm_limiter = SlidingWindowLimiter(settings.LLM_RATE_LIMIT, settings.LLM_RATE_WINDOW_S)
_events_limiter = SlidingWindowLimiter(settings.EVENTS_RATE_LIMIT, settings.EVENTS_RATE_WINDOW_S)
_voice_limiter = SlidingWindowLimiter(settings.VOICE_RATE_LIMIT, settings.VOICE_RATE_WINDOW_S)
_check_limiter = SlidingWindowLimiter(settings.CHECK_RATE_LIMIT, settings.CHECK_RATE_WINDOW_S)


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Trusts X-Forwarded-For's first hop ONLY when TRUST_FORWARDED_FOR is on
    (set it solely behind a proxy you control — the header is otherwise client-spoofable)."""
    if settings.TRUST_FORWARDED_FOR:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _enforce(limiter: SlidingWindowLimiter, request: Request, bucket: str) -> None:
    """Count one request against `limiter`, keyed by bucket+IP; 429 (with Retry-After) when over."""
    if not settings.RATE_LIMIT_ENABLED:
        return
    key = f"{bucket}:{_client_ip(request)}"
    if not limiter.allow(key):
        retry = int(limiter.retry_after(key)) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests — slow down a moment and try again.",
            headers={"Retry-After": str(retry)},
        )


async def auth_rate_limit(request: Request) -> None:
    """Brute-force guard for the auth endpoints (per client IP)."""
    _enforce(_auth_limiter, request, "auth")


async def llm_rate_limit(request: Request) -> None:
    """Cost guard for the model-backed endpoints (per client IP — anonymous abuse is the concern;
    authed practice is already bounded by the daily exercise quota)."""
    _enforce(_llm_limiter, request, "llm")


async def events_rate_limit(request: Request) -> None:
    """Storage-abuse guard for the public, anonymous-allowed analytics ingest (per client IP)."""
    _enforce(_events_limiter, request, "events")


async def voice_rate_limit(request: Request) -> None:
    """Cost guard for the voice endpoints (audio→Gemini is pricier than text; per client IP)."""
    _enforce(_voice_limiter, request, "voice")


async def check_rate_limit(request: Request) -> None:
    """Faucet guard for the deterministic /check grade endpoint (koku minting; per client IP)."""
    _enforce(_check_limiter, request, "check")
