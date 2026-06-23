"""Account endpoints (Phase 4): register, login, me, email verification."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.email_policy import BLOCKED_EMAIL_MESSAGE, is_blocked_email
from ..core.security import (
    create_access_token,
    create_verify_token,
    decode_verify_token,
    hash_password,
    verify_password,
)
from ..db.models import Event, LearnerProfile, ProcessedPayment, Progress, User
from ..deps import auth_rate_limit, get_current_user, get_db
from ..schemas import (
    AccountExport,
    ConsentIn,
    LoginIn,
    MessageOut,
    RegisterIn,
    TokenOut,
    UserOut,
)
from ..services import access, cosmetics as cosmetics_service
from ..services.account import build_account_export
from ..services.email import send_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])

# Fixed argon2 hash verified on the missing-user login path so an unknown email costs the same time
# as a wrong password (anti-enumeration; see login()). Computed once at import.
_DUMMY_PASSWORD_HASH = hash_password("login-timing-equalizer")


async def _get_by_email(db: AsyncSession, email: str) -> User | None:
    res = await db.execute(select(User).where(User.email == email))
    return res.scalar_one_or_none()


def _verify_link(user_id: str) -> str:
    """Activation URL embedded in the email; points at this backend's GET /auth/verify."""
    token = create_verify_token(user_id)
    base = settings.APP_BASE_URL.rstrip("/")
    return f"{base}/auth/verify?token={token}"


async def _send_activation(user: User) -> None:
    await send_verification_email(user.email, _verify_link(str(user.id)))


@router.post(
    "/register",
    response_model=TokenOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    email = payload.email.lower()
    if is_blocked_email(email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=BLOCKED_EMAIL_MESSAGE)
    existing = await _get_by_email(db, email)
    if existing is not None:
        # Don't disclose that the email is already taken (account enumeration). Instead behave like
        # a login: correct password → log in; wrong password → the same generic 401 as /login. Either
        # way the response is indistinguishable from a normal sign-in, so probing can't confirm which
        # emails exist. (A genuine new address still creates the account below.)
        if not verify_password(payload.password, existing.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password."
            )
        return TokenOut(access_token=create_access_token(str(existing.id)))
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # Immediate login (token), but the account is unverified until the emailed link is opened.
    await _send_activation(user)
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_rate_limit)])
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)) -> TokenOut:
    # Note: the Gmail block lives on /register only. Login must stay open so any pre-existing account
    # (e.g. created before the block, or via another path) is never locked out of its own data.
    user = await _get_by_email(db, payload.email.lower())
    # Constant-ish timing: run an argon2 verify even when the email is unknown, against a fixed dummy
    # hash, so a missing account doesn't return faster than a wrong password (login user-enumeration
    # via a timing oracle). Either branch ends in the same generic 401.
    if user is None:
        verify_password(payload.password, _DUMMY_PASSWORD_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password."
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password."
        )
    return TokenOut(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        is_verified=user.is_verified,
        is_premium=user.is_premium,
        premium_until=user.premium_until.isoformat() if user.premium_until else None,
        coins=user.coins,
        freezes=user.freezes,
        cosmetics=cosmetics_service.owned_ids(user),
        equipped=cosmetics_service.equipped_resolved(user),
        access=access.access_map(user),
        pd_consent_version=user.pd_consent_version or "",
        pd_consent_at=user.pd_consent_at.isoformat() if user.pd_consent_at else None,
    )


@router.post("/request-verification", response_model=MessageOut)
async def request_verification(user: User = Depends(get_current_user)) -> MessageOut:
    """Resend the activation email to the logged-in user (no-op if already verified)."""
    if user.is_verified:
        return MessageOut(message="Account already verified.")
    await _send_activation(user)
    return MessageOut(message="Verification email sent.")


@router.post("/consent", response_model=MessageOut)
async def record_consent(
    payload: ConsentIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Record acceptance of the STANDALONE personal-data + cross-border consent (152-ФЗ).

    The consent (transfer of the text the learner enters to Google LLC / Gemini, США) is presented
    in the app as its own document, separate from the оферта/Terms (01.09.2025 rule). This persists
    the version accepted + the server timestamp as the provable audit trail; it is surfaced verbatim
    in GET /auth/export. Re-accepting (e.g. a bumped version) simply overwrites with the latest."""
    user.pd_consent_version = payload.version
    user.pd_consent_at = datetime.now(timezone.utc)
    await db.commit()
    return MessageOut(message="Consent recorded.")


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    """Permanently delete the caller's account (store-compliance: in-app account deletion).

    A single User row delete fans out through the FKs declared in db/models.py:
      - progress / learner_profile  → deleted (relationship cascade="all, delete-orphan")
      - claimed_contracts / sent_emails → deleted (FK ondelete="CASCADE")
      - events / awarded_tokens / processed_payments → user_id set NULL (FK ondelete="SET NULL")
    Payment receipts (processed_payments) intentionally SURVIVE, anonymized, for refund/audit —
    they no longer reference the person. After this, the old token resolves to a missing user → 401.

    Erasure completeness (152-ФЗ): the FK SET NULL clears `Event.user_id`, but `Event.subject` still
    holds this user's id string — so before the delete we re-key the user's analytics rows to a fresh
    opaque subject. The event trail survives for aggregate retention (and stays a DISTINCT cohort, so
    the math is unaffected) but is no longer linkable to the deleted person.
    """
    anon_subject = f"deleted:{uuid.uuid4().hex}"
    await db.execute(
        update(Event).where(Event.subject == str(user.id)).values(subject=anon_subject, user_id=None)
    )
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/export", response_model=AccountExport)
async def export_account(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> AccountExport:
    """Return everything we hold about the caller as JSON (store-compliance: data export right).

    Account fields (no password hash), the progress + learner-profile snapshots, every analytics row
    still attributed to this user, and the purchase history (premium grants). Read-only — nothing is
    mutated."""
    progress = await db.get(Progress, user.id)
    profile = await db.get(LearnerProfile, user.id)
    events = (
        await db.execute(select(Event).where(Event.user_id == user.id).order_by(Event.ts))
    ).scalars().all()
    payments = (
        await db.execute(
            select(ProcessedPayment)
            .where(ProcessedPayment.user_id == user.id)
            .order_by(ProcessedPayment.created_at)
        )
    ).scalars().all()
    return build_account_export(user, progress, profile, events, payments)


@router.get("/verify", response_class=HTMLResponse)
async def verify(token: str, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    """Open the emailed link to activate. Returns a small HTML confirmation page."""
    sub = decode_verify_token(token)
    user = None
    if sub is not None:
        try:
            from uuid import UUID

            user = await db.get(User, UUID(sub))
        except ValueError:
            user = None
    if user is None:
        return HTMLResponse(_page("Link expired or invalid", "Please request a new link from the app."), status_code=400)
    if not user.is_verified:
        user.is_verified = True
        await db.commit()
    return HTMLResponse(_page("Account activated 🎉", "You can return to the app — all lessons are unlocked."))


def _page(title: str, sub: str) -> str:
    return f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<div style="font-family:system-ui,Arial,sans-serif;max-width:420px;margin:18vh auto;text-align:center;padding:0 20px">
  <h1 style="font-size:22px;margin:0 0 8px">{title}</h1>
  <p style="color:#555">{sub}</p>
</div>"""
