"""Account endpoints (Phase 4): register, login, me. Plus Google sign-in (optional)."""

from __future__ import annotations

import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.security import create_access_token, hash_password, verify_password
from ..db.models import User
from ..deps import get_current_user, get_db
from ..schemas import GoogleAuthIn, LoginIn, RegisterIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

_GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


async def _get_by_email(db: AsyncSession, email: str) -> User | None:
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


async def _verify_google_id_token(id_token: str) -> str:
    """Validate a Google ID token and return the verified email. Google's tokeninfo endpoint checks
    the signature/expiry; we additionally pin the audience to our client ID and require a verified
    email from a Google issuer. Raises HTTPException on any problem."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_GOOGLE_TOKENINFO, params={"id_token": id_token})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Couldn't reach Google.") from exc
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token.")
    data = resp.json()
    if data.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token was issued for another app.")
    if data.get("iss") not in _GOOGLE_ISSUERS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Untrusted Google token issuer.")
    if str(data.get("email_verified")).lower() != "true" or not data.get("email"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified.")
    return str(data["email"]).lower()


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


@router.post("/google", response_model=TokenOut)
async def google(payload: GoogleAuthIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    """Sign in (or sign up) with a verified Google ID token. Find-or-create the user by email and
    issue our own JWT — identical to password login from the client's perspective."""
    email = await _verify_google_id_token(payload.id_token)
    user = await _get_by_email(db, email)
    if user is None:
        # No password for Google accounts; store a random unguessable hash so the column stays
        # non-null and password login for this account is impossible (must use Google).
        user = User(email=email, password_hash=hash_password(secrets.token_urlsafe(32)))
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=str(user.id), email=user.email)
