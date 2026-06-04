"""Account endpoints (Phase 4): register, login, me."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import create_access_token, hash_password, verify_password
from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


async def _get_by_email(db: AsyncSession, email: str) -> User | None:
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    email = payload.email.lower()
    if await _get_by_email(db, email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.post("/login", response_model=TokenOut)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    user = await _get_by_email(db, payload.email.lower())
    # Verify even when the user is missing to keep timing uniform isn't trivial here; a generic
    # 401 avoids leaking which emails exist.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password."
        )
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=str(user.id), email=user.email)
