"""One-time, idempotent DB bootstrap on a Neon branch (design doc 6.2).

Runs as the Neon owner role over the direct (unpooled) URL:
- installs extensions (vector, pg_trgm, pgcrypto)
- creates the runtime role brain_app: NOSUPERUSER, NOBYPASSRLS, not a table owner,
  so Row-Level Security always applies to it
- grants it DML on tables the owner creates later (migrations)
- writes APP_DB_PASSWORD into .env (the runtime URL is derived from DATABASE_URL)

Usage: uv run brain-db-bootstrap [--rotate-password]
"""

import argparse
import asyncio
import re
import secrets
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import make_url

from brain.config import get_settings
from brain.db.engine import create_engine

APP_ROLE = "brain_app"
ENV_FILE = Path(".env")


def _set_env_var(key: str, value: str) -> None:
    content = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.exists() else ""
    line = f"{key}={value}"
    if re.search(rf"^{key}=.*$", content, flags=re.M):
        content = re.sub(rf"^{key}=.*$", lambda _: line, content, flags=re.M)
    else:
        content = content.rstrip("\n") + f"\n{line}\n"
    ENV_FILE.write_text(content, encoding="utf-8")


async def bootstrap(rotate_password: bool) -> None:
    s = get_settings()
    if not s.database_url_unpooled or not s.database_url:
        raise SystemExit("DATABASE_URL / DATABASE_URL_UNPOOLED missing: run `neon deploy` first")

    engine = create_engine(s.database_url_unpooled)
    password = None
    async with engine.begin() as conn:
        for ext in ("vector", "pg_trgm", "pgcrypto"):
            await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext}"))

        exists = await conn.scalar(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}
        )
        if not exists or rotate_password or not s.app_db_password:
            # Neon requires >= 60 bits of entropy for SQL-created role passwords.
            password = secrets.token_urlsafe(32)
            verb = "ALTER" if exists else "CREATE"
            await conn.execute(
                text(
                    f"{verb} ROLE {APP_ROLE} LOGIN PASSWORD '{password}' "
                    "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
                )
            )

        db = make_url(s.database_url_unpooled).database
        await conn.execute(text(f'GRANT CONNECT ON DATABASE "{db}" TO {APP_ROLE}'))
        await conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}"))
        await conn.execute(text(f"REVOKE CREATE ON SCHEMA public FROM {APP_ROLE}"))
        await conn.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}"
            )
        )
        await conn.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                f"GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}"
            )
        )
        await conn.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                f"GRANT EXECUTE ON FUNCTIONS TO {APP_ROLE}"
            )
        )
    await engine.dispose()

    if password:
        _set_env_var("APP_DB_PASSWORD", password)
        print(f"{APP_ROLE} password set; APP_DB_PASSWORD written to {ENV_FILE}")
    print("bootstrap ok")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--rotate-password", action="store_true")
    asyncio.run(bootstrap(p.parse_args().rotate_password))
