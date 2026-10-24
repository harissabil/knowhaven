"""Runtime DB access as brain_app (RLS enforced).

Every tenant-scoped transaction starts with set_config('app.tenant_id', ..., true), which is
transaction-local, so it is safe through the PgBouncer pooler and can't leak into the next
request. tenant_id must come from the session/MCP token, never from client input or the model.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from brain.config import get_settings
from brain.db.engine import create_engine


@lru_cache
def get_engine() -> AsyncEngine:
    return create_engine(get_settings().app_database_url)


@lru_cache
def _sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def set_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
    )


@asynccontextmanager
async def tenant_session(tenant_id: UUID) -> AsyncIterator[AsyncSession]:
    """One transaction scoped to a tenant. Commits on success, rolls back on error."""
    async with _sessionmaker()() as session, session.begin():
        await set_tenant(session, tenant_id)
        yield session


@asynccontextmanager
async def global_session() -> AsyncIterator[AsyncSession]:
    """One transaction with no tenant set: only global tables (users, sessions) and the
    pre-tenant lookup functions return rows; every tenant table returns zero rows."""
    async with _sessionmaker()() as session, session.begin():
        yield session
