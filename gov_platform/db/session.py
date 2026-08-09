"""Async SQLAlchemy engine and session management.

The engine URL is dialect-agnostic (``settings.database_url``). In
production this points at PostgreSQL via ``asyncpg``; tests and offline
CI point it at SQLite via ``aiosqlite`` so the ORM layer and Alembic
migrations can be exercised without a live Postgres server.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ..config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    if settings.database_url.startswith("sqlite"):
        # SQLite (test/offline use only) doesn't use a real connection pool
        # in the same sense -- pool_size/max_overflow aren't valid kwargs
        # for its pooling class.
        return create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_timeout=settings.database_pool_timeout_seconds,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped AsyncSession."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session
