"""ORM models (Phase 4): users + per-user progress snapshot.

Progress is stored as one JSONB row per user — the exact client snapshot from
mobile/store/progress.tsx — which matches the snapshot-sync model and stays fast.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Email confirmation (gates full access). Registration still logs the user in immediately, but
    # lessons stay locked (except a small daily starter) until this flips via the verification link.
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # Server-side starter quota for UNVERIFIED users: how many exercises served today (UTC day).
    # Lets the backend enforce the "starter only" gate, not just the client.
    starter_day: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    starter_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # --- Economy (monetization plan, branch 1) ---
    # Premium ("Black Belt") entitlement. Effective premium is the `is_premium` property below: true
    # while a PAID subscription is live (premium_until in the future) OR when manually comped
    # (premium_override = "Black Belt forever", flipped by /dev/premium or an admin). Paid grants come
    # from the billing webhooks (services/billing.py) and only ever EXTEND premium_until — they never
    # touch the override. Everything else reads `user.is_premium`, so subscription expiry is automatic.
    premium_override: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    premium_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Soft currency ("koku"). Server-authoritative: earned only via /check on a correct answer,
    # spent only via /wallet/spend — the client can never set a balance directly.
    coins: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Streak-freeze charms ("omamori") owned. Bought in the shop; consumed by the client's streak
    # logic via /wallet/spend (item="use_freeze").
    freezes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Scroll rewards (variable reinforcement): daily cap tracking (UTC day).
    scroll_day: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    scrolls_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Rewarded-ad koku grants: daily cap tracking (UTC day). Server-authoritative, like scrolls.
    ad_reward_day: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    ad_rewards_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # First-win-of-day bonus (engagement v2): the UTC day the last daily bonus was granted, so the
    # bonus fires once per day on the first correct answer.
    last_win_day: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    # Current run of consecutive correct answers (engagement v2 combo koku). Server-tracked: +1 per
    # genuine correct /check, reset to 0 on a wrong one — so the combo bonus can't be client-faked.
    correct_run: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # --- Cosmetics (engagement v2): koku desire sink. Server-authoritative ownership. ---
    # Owned cosmetic ids (the starter skin is implicit — always owned, not stored here). Bought via
    # /cosmetics/buy (price validated server-side); the client can never grant itself an item.
    cosmetics: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Equipped cosmetic per slot, e.g. {"sensei": "sensei_sage"}. Unset slot → the starter default.
    equipped: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # Unlocked content ids (engagement v2 Phase 3): koku-bought story arcs / packs. Free content is
    # never stored here. Server-authoritative — the client can't grant itself an unlock.
    unlocks: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # --- 152-ФЗ cross-border consent (PD transfer to Google LLC / Gemini, США) ---
    # Audit trail for the STANDALONE personal-data + cross-border consent (separate from the
    # оферта/Terms, per the 01.09.2025 rule): the version string the user accepted + when. Empty
    # version / NULL timestamp = not yet accepted. Written by POST /auth/consent; surfaced verbatim
    # in the data export (GET /auth/export) so the acceptance is provable.
    pd_consent_version: Mapped[str] = mapped_column(String(20), nullable=False, server_default="")
    pd_consent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def is_premium(self) -> bool:
        """Effective Black Belt status: a manual comp (override) OR a live paid subscription. Read
        everywhere instead of a raw column so a lapsed subscription downgrades automatically."""
        if self.premium_override:
            return True
        until = self.premium_until
        return until is not None and until > datetime.now(timezone.utc)

    progress: Mapped["Progress"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    learner_profile: Mapped["LearnerProfile"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class Progress(Base):
    __tablename__ = "progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="progress")


class LearnerProfile(Base):
    """Server-side learner memory (Praktika adoption, Stage 1).

    One JSONB row per user — the shared profile all feedback/planning reads: structured goal,
    sphere/sub-roles, interests, tone (soft/balanced/strict), weak-spot summary, goal history.
    Shape is validated by schemas.LearnerProfileData. JSONB so Stage 2 agents can extend it
    without a migration."""

    __tablename__ = "learner_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="learner_profile")


class Event(Base):
    """Analytics event — the instrumentation behind the north-star metric (Day-7 retention).

    Append-only, one row per tracked action. `subject` is the retention identity: the user id for
    logged-in callers, else the client-generated anonymous id — so a learner who later signs in is
    still trackable pre-account. `user_id` is the FK when known (nullable: events fire before login).
    `props` is free-form JSONB so new events need no migration. No PII beyond what the client sends.
    """

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Retention identity: user.id when logged in, else the anonymous client id. Always present.
    subject: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    props: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Server receipt time — the canonical timestamp for cohorting (client clocks are untrusted).
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_events_subject_ts", "subject", "ts"),
        Index("ix_events_name_ts", "name", "ts"),
    )


class AwardedToken(Base):
    """One-time-use guard for /check koku awards (anti-replay).

    `jti` is the SHA-256 of the sealed exercise token string — unique per issued exercise. The first
    correct /check for a token inserts the row and credits koku; a replay of the SAME token hits the
    PK conflict and credits nothing. Rows older than EXERCISE_TOKEN_TTL_S can be pruned (the token
    itself has expired by then). `user_id` is informational (SET NULL on user delete)."""

    __tablename__ = "awarded_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_awarded_tokens_created_at", "created_at"),)


class ClaimedContract(Base):
    """One-time-per-day guard for daily-contract koku payouts (engagement v2, Phase 2).

    PK is (user_id, day, contract_id): the first claim inserts the row and credits koku; a second
    claim of the same contract on the same day hits the PK conflict and pays nothing. `day` is the
    UTC contract day string (shared with gating._utc_day)."""

    __tablename__ = "claimed_contracts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    contract_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SentEmail(Base):
    """One-time guard for lifecycle re-engagement emails (Day-2 / Day-6 return nudges).

    PK is (user_id, kind): the first send of a given kind to a user inserts the row; the daily batch
    job (services.lifecycle_email + scripts/send_return_emails.py) claims this row BEFORE sending, so
    a user receives each nudge at most once and concurrent/retried runs can't double-mail. `kind` is
    a stable slug like "return_day2" / "return_day6"."""

    __tablename__ = "sent_emails"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(40), primary_key=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ProcessedPayment(Base):
    """Idempotency guard for billing webhooks (web-checkout premium: YooKassa + crypto/USDT).

    PK is (provider, external_id): the first successful payment notification inserts the row and
    extends the buyer's premium_until; a replay or retried webhook for the SAME payment hits the PK
    conflict and grants nothing. Same claim-before-grant pattern as AwardedToken / SentEmail —
    payment webhooks are at-least-once, so the grant MUST be idempotent. `user_id` is the buyer (SET
    NULL on delete: the receipt outlives the account); `plan`/`days` record what was granted for
    support/audit/refunds."""

    __tablename__ = "processed_payments"

    provider: Mapped[str] = mapped_column(String(20), primary_key=True)  # "yookassa" | "crypto"
    external_id: Mapped[str] = mapped_column(String(128), primary_key=True)  # provider's payment id
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    plan: Mapped[str] = mapped_column(String(40), nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
