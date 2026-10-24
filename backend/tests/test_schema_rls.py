"""T32 and friends: tenant isolation is enforced by the database itself (design doc 6.2).

Runs against the linked Neon branch (use `dev`, not production). Fixture rows are created as
brain_app exactly like the app will, and removed by the owner role afterwards.

Run: uv run pytest tests/test_schema_rls.py -v
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from brain.config import get_settings
from brain.db.engine import create_engine
from brain.db.models import (
    GLOBAL_TABLES,
    AuditLog,
    Base,
    Integration,
    Invite,
    McpToken,
    Membership,
    PermissionState,
    Role,
    Tenant,
    User,
    UserRole,
)
from brain.db.session import global_session, tenant_session

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)

TENANT_TABLES = sorted(set(Base.metadata.tables) - GLOBAL_TABLES)


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.fixture(scope="module")
async def owner_engine():
    engine = create_engine(get_settings().database_url_unpooled)
    yield engine
    await engine.dispose()


@pytest.fixture
async def two_tenants(owner_engine):
    """Two tenants (A, B), each with one active member and one role, created as brain_app."""
    made = []
    for label in ("a", "b"):
        user_id, tenant_id, role_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        async with global_session() as s:
            s.add(User(id=user_id, email=f"{user_id}@test.local", name=label, password_hash="x"))
        async with tenant_session(tenant_id) as s:
            s.add(
                Tenant(id=tenant_id, name=f"T-{label}", slug=f"t-{tenant_id}", created_by=user_id)
            )
            await s.flush()
            s.add(PermissionState(tenant_id=tenant_id))
            s.add(Membership(tenant_id=tenant_id, user_id=user_id, status="active"))
            s.add(Role(id=role_id, tenant_id=tenant_id, key="staff", name="Staf"))
        made.append((tenant_id, user_id, role_id))
    yield made
    async with owner_engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM tenants WHERE id = ANY(:ids)"), {"ids": [t for t, _, _ in made]}
        )
        await conn.execute(
            text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": [u for _, u, _ in made]}
        )


async def test_every_tenant_table_has_forced_rls(owner_engine):
    async with owner_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                           AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant_id,
                   EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                           AND p.polname = 'tenant_isolation') AS has_policy
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'alembic_version'
            """
                )
            )
        ).all()
    by_name = {r.relname: r for r in rows}
    assert set(by_name) == set(Base.metadata.tables), "DB tables drifted from models"
    unprotected_globals = {n for n, r in by_name.items() if not r.has_tenant_id} - {"tenants"}
    assert unprotected_globals == GLOBAL_TABLES
    for name in TENANT_TABLES:
        r = by_name[name]
        assert r.relrowsecurity and r.relforcerowsecurity and r.has_policy, name


async def test_no_tenant_context_sees_nothing(two_tenants):
    async with global_session() as s:
        for table in TENANT_TABLES:
            count = await s.scalar(text(f"SELECT count(*) FROM {table}"))
            assert count == 0, f"{table} visible without app.tenant_id"


async def test_tenant_context_sees_only_own_rows(two_tenants):
    (ta, _, role_a), (tb, _, _) = two_tenants
    async with tenant_session(ta) as s:
        assert (await s.scalars(select(Tenant.id))).all() == [ta]
        assert (await s.scalars(select(Role.id))).all() == [role_a]
        assert await s.scalar(select(func.count()).select_from(Membership)) == 1
        # Even an explicit filter for the other tenant returns nothing.
        assert await s.scalar(select(func.count()).where(Role.tenant_id == tb)) == 0


async def test_cannot_write_into_other_tenant(two_tenants):
    (ta, _, _), (tb, _, _) = two_tenants
    with pytest.raises(DBAPIError, match="row-level security"):
        async with tenant_session(ta) as s:
            s.add(Role(tenant_id=tb, key="evil", name="Evil"))
            await s.flush()


async def test_composite_fk_blocks_cross_tenant_reference(two_tenants):
    (ta, ua, _), (_, _, role_b) = two_tenants
    with pytest.raises(IntegrityError):
        async with tenant_session(ta) as s:
            s.add(UserRole(tenant_id=ta, user_id=ua, role_id=role_b))
            await s.flush()


async def test_app_role_cannot_disable_rls(two_tenants):
    (ta, _, _), _ = two_tenants
    with pytest.raises(DBAPIError, match="must be owner"):
        async with tenant_session(ta) as s:
            await s.execute(text("ALTER TABLE roles DISABLE ROW LEVEL SECURITY"))


async def test_audit_log_is_append_only(two_tenants):
    (ta, ua, _), _ = two_tenants
    async with tenant_session(ta) as s:
        s.add(AuditLog(tenant_id=ta, seq=1, actor_user_id=ua, prev_hash="0", row_hash="h1"))
    with pytest.raises(DBAPIError, match="permission denied"):
        async with tenant_session(ta) as s:
            await s.execute(update(AuditLog).values(response_text="tampered"))
    with pytest.raises(DBAPIError, match="permission denied"):
        async with tenant_session(ta) as s:
            await s.execute(text("DELETE FROM audit_log"))


async def test_pre_tenant_lookups(two_tenants):
    (ta, ua, role_a), (tb, ub, _) = two_tenants
    now = datetime.now(UTC)
    good, revoked, expired, token, code = (uuid.uuid4().hex for _ in range(5))
    async with tenant_session(ta) as s:
        s.add_all(
            [
                Invite(
                    tenant_id=ta,
                    token_hash=_h(good),
                    default_role_id=role_a,
                    expires_at=now + timedelta(days=1),
                ),
                Invite(
                    tenant_id=ta,
                    token_hash=_h(revoked),
                    default_role_id=role_a,
                    expires_at=now + timedelta(days=1),
                    revoked_at=now,
                ),
                Invite(
                    tenant_id=ta,
                    token_hash=_h(expired),
                    default_role_id=role_a,
                    expires_at=now - timedelta(seconds=1),
                ),
                McpToken(tenant_id=ta, user_id=ua, token_hash=_h(token), label="wb"),
                Integration(
                    tenant_id=ta,
                    type="slack",
                    external_workspace_id=f"T{ta.hex[:8]}",
                    config_encrypted=b"x",
                ),
            ]
        )
        await s.execute(update(Tenant).values(join_code_hash=_h(code)))

    async with global_session() as s:
        inv = (await s.execute(text("SELECT * FROM resolve_invite(:h)"), {"h": _h(good)})).all()
        assert [(r.tenant_id, r.default_role_id) for r in inv] == [(ta, role_a)]
        for bad in (revoked, expired, "nope"):
            assert (
                await s.execute(text("SELECT * FROM resolve_invite(:h)"), {"h": _h(bad)})
            ).all() == []

        joined = await s.execute(text("SELECT * FROM resolve_join_code(:h)"), {"h": _h(code)})
        assert [r.tenant_id for r in joined.all()] == [ta]

        mine = (await s.execute(text("SELECT * FROM list_my_memberships(:u)"), {"u": ua})).all()
        assert [r.tenant_id for r in mine] == [ta]
        theirs = await s.execute(text("SELECT * FROM list_my_memberships(:u)"), {"u": ub})
        assert [r.tenant_id for r in theirs.all()] == [tb]

        tok = await s.execute(text("SELECT * FROM resolve_mcp_token(:h)"), {"h": _h(token)})
        assert [(r.tenant_id, r.user_id) for r in tok.all()] == [(ta, ua)]

        routed = await s.scalar(
            text("SELECT resolve_integration('slack', :t)"), {"t": f"T{ta.hex[:8]}"}
        )
        assert routed == ta
        assert await s.scalar(text("SELECT resolve_integration('slack', 'T-unknown')")) is None

    # A removed member's MCP token stops resolving immediately (T33).
    async with tenant_session(ta) as s:
        await s.execute(update(Membership).values(status="removed", removed_at=now))
    async with global_session() as s:
        tok = await s.execute(text("SELECT * FROM resolve_mcp_token(:h)"), {"h": _h(token)})
        assert tok.all() == []
