"""FastAPI dependencies: DB session per request + current-user resolution (Phase 4)."""

from __future__ import annotations

import uuid
from typing import AsyncIterator, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

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
