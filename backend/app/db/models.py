"""ORM models (Phase 4): users + per-user progress snapshot.

Progress is stored as one JSONB row per user — the exact client snapshot from
mobile/store/progress.tsx — which matches the snapshot-sync model and stays fast.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid, func
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
    # Premium ("Black Belt") entitlement. Set manually / by a payment provider later — the flag is
    # the single source of truth the rest of the gating reads.
    is_premium: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # Soft currency ("koku"). Server-authoritative: earned only via /check on a correct answer,
    # spent only via /wallet/spend — the client can never set a balance directly.
    coins: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Streak-freeze charms ("omamori") owned. Bought in the shop; consumed by the client's streak
    # logic via /wallet/spend (item="use_freeze").
    freezes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Scroll rewards (variable reinforcement): daily cap tracking (UTC day).
    scroll_day: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    scrolls_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

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
