"""Phase 2: auth, tenancy, onboarding (design doc 4.4, 6.3). Covers T27, T29, T30, T33 (API level).

Runs against the linked Neon branch through the real FastAPI app.
"""

import pytest
from sqlalchemy import text

from brain.config import get_settings
from brain.db.engine import create_engine

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)


@pytest.fixture(scope="module")
async def owner():
    engine = create_engine(get_settings().database_url_unpooled)
    yield engine
    await engine.dispose()


async def _company(user, name="PT Uji Coba"):
    r = await user.post("/api/tenants", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


async def _role_id(admin, key):
    roles = (await admin.get("/api/admin/roles")).json()
    return next(r["id"] for r in roles if r["key"] == key)


async def _invite(admin, role_key="new_hire", **kw):
    r = await admin.post(
        "/api/admin/invites", json={"role_id": await _role_id(admin, role_key), **kw}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _token(invite):
    return invite["link"].rsplit("/", 1)[1]


async def test_register_login_logout(make_user):
    u = await make_user("Dimas")
    me = (await u.get("/api/me")).json()
    assert me["email"] == u.email and me["active_tenant"] is None and me["memberships"] == []

    assert (await u.post("/api/auth/logout")).status_code == 204
    assert (await u.get("/api/me")).status_code == 401

    wrong = await u.post("/api/auth/login", json={"email": u.email, "password": "nope-nope-1"})
    unknown = await u.post(
        "/api/auth/login", json={"email": "ghost@pytest.wb-demo.com", "password": "nope-nope-1"}
    )
    # Unknown email and wrong password are indistinguishable.
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "invalid_credentials"}

    ok = await u.post("/api/auth/login", json={"email": u.email.upper(), "password": u.password})
    assert ok.status_code == 200
    assert (await u.get("/api/me")).status_code == 200


async def test_duplicate_email_rejected(make_user):
    u = await make_user()
    r = await u.post(
        "/api/auth/register", json={"email": u.email, "name": "x", "password": "another-pass-1"}
    )
    assert r.status_code == 409 and r.json()["detail"] == "email_taken"


async def test_state_changing_requests_need_csrf(make_user):
    u = await make_user()
    r = await u.post("/api/tenants", json={"name": "PT Tanpa CSRF"}, csrf=False)
    assert r.status_code == 403 and r.json()["detail"] == "csrf_failed"


async def test_create_company_bootstraps_roles(make_user, owner):
    """T27 (part 1): creator becomes Owner+Admin with template roles and a join code."""
    admin = await make_user("Admin SRN")
    created = await _company(admin, "PT Sinar Rantai Nusantara")
    active = created["me"]["active_tenant"]
    assert active["roles"] == ["admin", "owner"]  # no business role: admin != data access
    assert active["permission_version"] == 1

    roles = (await admin.get("/api/admin/roles")).json()
    assert {r["key"] for r in roles} == {
        "owner", "admin", "auditor", "new_hire", "staff", "ops", "hr", "project_mgr",
        "finance", "direksi",
    }  # fmt: skip
    assert (await admin.get("/api/admin/join-code")).json()["join_code"] == created["join_code"]

    async with owner.connect() as c:
        pii = await c.scalar(
            text(
                "SELECT array_agg(p.pii_type ORDER BY p.pii_type) FROM pii_permissions p "
                "JOIN roles r ON r.id = p.role_id WHERE p.tenant_id = :t AND r.key = 'hr'"
            ),
            {"t": created["tenant_id"]},
        )
    assert pii == ["bank_account", "email", "nik", "npwp", "phone"]


async def test_invite_link_flow(make_user):
    """T27 (part 2): invite with a starting role; single use; revocable; no system roles."""
    admin = await make_user("Admin")
    await _company(admin)
    invite = await _invite(admin, "new_hire", max_uses=1)

    dimas = await make_user("Dimas")
    r = await dimas.post(f"/api/join/{_token(invite)}")
    assert r.status_code == 200 and r.json()["status"] == "active"
    ctx = (await dimas.get("/api/context")).json()
    assert ctx["roles"] == ["new_hire"] and ctx["permission_version"] == 2

    late = await make_user()
    assert (await late.post(f"/api/join/{_token(invite)}")).status_code == 404  # used up

    revoked = await _invite(admin)
    assert (await admin.delete(f"/api/admin/invites/{revoked['id']}")).status_code == 204
    assert (await late.post(f"/api/join/{_token(revoked)}")).status_code == 404

    bad = await admin.post("/api/admin/invites", json={"role_id": await _role_id(admin, "admin")})
    assert bad.status_code == 422 and bad.json()["detail"] == "invite_role_must_be_business"


async def test_join_code_is_pending_until_approved(make_user):
    """T30: pending members get zero access until an admin approves and assigns roles."""
    admin = await make_user("Admin")
    code = (await _company(admin))["join_code"]

    rina = await make_user("Rina")
    r = await rina.post("/api/tenants/join-code", json={"code": code.lower().replace("-", "")})
    assert r.status_code == 200 and r.json()["status"] == "pending"

    me = (await rina.get("/api/me")).json()
    assert me["active_tenant"]["status"] == "pending" and me["active_tenant"]["roles"] == []
    assert (await rina.get("/api/context")).json() == {"detail": "membership_pending"}
    assert (await rina.get("/api/admin/members")).status_code == 403

    members = (await admin.get("/api/admin/members")).json()
    assert [m["status"] for m in members if m["user_id"] == rina.user_id] == ["pending"]

    staff = await _role_id(admin, "staff")
    ops = await _role_id(admin, "ops")
    r = await admin.post(
        f"/api/admin/members/{rina.user_id}/approve", json={"role_ids": [staff, ops]}
    )
    assert r.status_code == 204
    ctx = (await rina.get("/api/context")).json()
    assert ctx["roles"] == ["ops", "staff"] and ctx["permission_version"] == 2

    assert (
        await rina.post("/api/tenants/join-code", json={"code": "ZZZZ-ZZZZ"})
    ).status_code == 404


async def test_reject_pending_member(make_user):
    admin = await make_user()
    code = (await _company(admin))["join_code"]
    outsider = await make_user()
    await outsider.post("/api/tenants/join-code", json={"code": code})
    assert (await admin.post(f"/api/admin/members/{outsider.user_id}/reject")).status_code == 204
    assert (await outsider.get("/api/context")).json() == {"detail": "not_a_member"}
    assert (await outsider.get("/api/me")).json()["memberships"] == []


async def test_removed_member_loses_access_and_tokens(make_user, owner):
    """T33 (API level): removal revokes MCP tokens, drops roles, bumps the permission version."""
    admin = await make_user("Admin")
    tenant_id = (await _company(admin))["tenant_id"]
    member = await make_user("Mantan")
    await member.post(f"/api/join/{_token(await _invite(admin, 'staff'))}")
    async with owner.begin() as c:
        await c.execute(
            text(
                "INSERT INTO mcp_tokens (tenant_id, user_id, token_hash, label) "
                "VALUES (:t, :u, :h, 'wb')"
            ),
            {"t": tenant_id, "u": member.user_id, "h": f"test-{member.user_id}"},
        )

    assert (await admin.delete(f"/api/admin/members/{member.user_id}")).status_code == 204
    assert (await member.get("/api/context")).json() == {"detail": "not_a_member"}
    async with owner.connect() as c:
        revoked = await c.scalar(
            text("SELECT revoked_at IS NOT NULL FROM mcp_tokens WHERE user_id = :u"),
            {"u": member.user_id},
        )
        version = await c.scalar(
            text("SELECT version FROM permission_state WHERE tenant_id = :t"), {"t": tenant_id}
        )
    assert revoked is True
    assert version == 3  # join (+1), remove (+1)

    # The sole owner can't leave; admins can't remove themselves through the admin endpoint.
    assert (await admin.post("/api/tenants/leave")).json() == {"detail": "last_owner"}
    assert (await admin.delete(f"/api/admin/members/{admin.user_id}")).status_code == 409


async def test_tenant_switch_and_cross_tenant_isolation(make_user):
    """T29 (API level): a consultant in two tenants only acts in the active one."""
    srn_admin, klm_admin = await make_user("Admin SRN"), await make_user("Admin KLM")
    srn = await _company(srn_admin, "PT SRN")
    klm = await _company(klm_admin, "CV KLM")
    yoga = await make_user("Yoga")
    await yoga.post(f"/api/join/{_token(await _invite(srn_admin, 'staff'))}")
    await yoga.post(f"/api/join/{_token(await _invite(klm_admin, 'staff'))}")

    me = (await yoga.get("/api/me")).json()
    assert {m["tenant_id"] for m in me["memberships"]} == {srn["tenant_id"], klm["tenant_id"]}
    assert me["active_tenant"]["tenant_id"] == klm["tenant_id"]  # last joined

    r = await yoga.post("/api/tenants/switch", json={"tenant_id": srn["tenant_id"]})
    assert r.json()["active_tenant"]["tenant_name"] == "PT SRN"
    assert (await yoga.get("/api/context")).json()["tenant_id"] == srn["tenant_id"]

    # Can't switch into a tenant you're not a member of.
    stranger = await make_user()
    r = await stranger.post("/api/tenants/switch", json={"tenant_id": srn["tenant_id"]})
    assert r.status_code == 403

    # SRN's admin can't see or act on KLM's members: they simply don't exist from SRN.
    assert klm_admin.user_id not in {
        m["user_id"] for m in (await srn_admin.get("/api/admin/members")).json()
    }
    r = await srn_admin.delete(f"/api/admin/members/{klm_admin.user_id}")
    assert r.status_code == 404 and r.json()["detail"] == "member_not_found"


async def test_non_admin_cannot_use_admin_endpoints(make_user):
    admin = await make_user()
    await _company(admin)
    staff = await make_user()
    await staff.post(f"/api/join/{_token(await _invite(admin, 'staff'))}")
    for path in (
        "/api/admin/members",
        "/api/admin/invites",
        "/api/admin/roles",
        "/api/admin/join-code",
    ):
        r = await staff.get(path)
        assert r.status_code == 403 and r.json()["detail"] == "admin_required", path
