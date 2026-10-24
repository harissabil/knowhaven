"""Integration checks against the linked Neon branch (DB + Object Storage).

Run: uv run pytest tests/test_infra.py -v
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from brain import storage
from brain.config import get_settings
from brain.db.engine import create_engine

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)


@pytest.fixture
async def app_engine():
    engine = create_engine(get_settings().app_database_url)
    yield engine
    await engine.dispose()


@pytest.fixture
async def owner_engine():
    engine = create_engine(get_settings().database_url_unpooled)
    yield engine
    await engine.dispose()


async def test_app_role_cannot_bypass_rls(app_engine):
    async with app_engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    "SELECT current_user, r.rolsuper, r.rolbypassrls, "
                    "pg_has_role(current_user, 'neon_superuser', 'MEMBER') AS neon_su, "
                    "has_schema_privilege('public', 'CREATE') AS can_create "
                    "FROM pg_roles r WHERE r.rolname = current_user"
                )
            )
        ).one()
    assert row.current_user == "brain_app"
    assert not row.rolsuper
    assert not row.rolbypassrls
    assert not row.neon_su
    assert not row.can_create


async def test_extensions(app_engine):
    async with app_engine.connect() as conn:
        dist = await conn.scalar(text("SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector"))
        sim = await conn.scalar(text("SELECT similarity('Kenari', 'Kenary')"))
    assert dist == pytest.approx(1.0)
    assert sim > 0.3


async def test_rls_tenant_isolation_through_pooler(app_engine, owner_engine):
    """Owner creates an RLS-protected table; brain_app over the pooler sees only its tenant."""
    table = f"_rls_probe_{uuid.uuid4().hex[:8]}"
    t_a, t_b = uuid.uuid4(), uuid.uuid4()
    async with owner_engine.begin() as conn:
        await conn.execute(text(f"CREATE TABLE {table} (tenant_id uuid NOT NULL, v text)"))
        await conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        await conn.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
        await conn.execute(
            text(
                f"CREATE POLICY tenant_isolation ON {table} "
                "USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)"
            )
        )
        await conn.execute(text(f"GRANT SELECT ON {table} TO brain_app"))
        await conn.execute(
            text(f"INSERT INTO {table} VALUES (:a, 'srn'), (:b, 'klm')"), {"a": t_a, "b": t_b}
        )
    try:
        async with app_engine.begin() as conn:
            assert await conn.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            await conn.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(t_a)}
            )
            rows = (await conn.execute(text(f"SELECT v FROM {table}"))).scalars().all()
            assert rows == ["srn"]
        # transaction-local setting must not leak to the next pooled transaction
        async with app_engine.begin() as conn:
            assert await conn.scalar(text(f"SELECT count(*) FROM {table}")) == 0
    finally:
        async with owner_engine.begin() as conn:
            await conn.execute(text(f"DROP TABLE {table}"))


async def test_object_storage_roundtrip():
    key = storage.tenant_key(uuid.uuid4(), "probe", f"{uuid.uuid4().hex}.txt")
    body = b"uang bensin Rp750.000"
    await storage.check()
    await storage.put_object(key, body, "text/plain")
    try:
        assert await storage.get_object(key) == body
        async with httpx.AsyncClient() as client:
            res = await client.get(storage.presigned_get_url(key, expires_in=60))
        assert res.status_code == 200
        assert res.content == body
    finally:
        await storage.delete_object(key)
