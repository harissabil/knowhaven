from uuid import uuid4

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

# libpq-only params that asyncpg rejects; SSL is passed via connect_args instead.
_LIBPQ_PARAMS = ("sslmode", "channel_binding")


def asyncpg_url(url: str) -> tuple[str, dict]:
    """Turn a Neon/libpq URL into a SQLAlchemy asyncpg URL plus connect_args."""
    u = make_url(url).set(drivername="postgresql+asyncpg")
    sslmode = u.query.get("sslmode")
    u = u.difference_update_query(_LIBPQ_PARAMS)
    connect_args: dict = {}
    if sslmode and sslmode != "disable":
        connect_args["ssl"] = "require"
    if u.host and "-pooler" in u.host:
        # PgBouncer transaction mode: no client-side statement cache, unique statement names.
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_name_func"] = lambda: f"__asyncpg_{uuid4()}__"
    return u.render_as_string(hide_password=False), connect_args


def create_engine(url: str, **kwargs) -> AsyncEngine:
    sa_url, connect_args = asyncpg_url(url)
    return create_async_engine(
        sa_url, connect_args=connect_args, pool_pre_ping=True, pool_recycle=300, **kwargs
    )
