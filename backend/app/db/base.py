"""Async SQLAlchemy engine, session factory, and declarative base (Phase 4).

The schema is owned by Alembic (see backend/alembic) — no create_all here.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from ..core.config import settings

# pool_pre_ping avoids handing out dead connections after a DB restart / idle drop.
engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass
