"""Phase 3: visibility rule (design doc 8.4), RBAC admin API (8, 14.1), audit hash chain.

Runs against the linked Neon branch (use `dev`).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from brain.audit import log as audit
from brain.config import get_settings
from brain.db.engine import create_engine
from brain.db.models import (
    AuditLog,
    Container,
    ContainerAcl,
    ItemAclOverride,
    Role,
    SourceItem,
)
from brain.db.session import tenant_session
from brain.rbac.context import RequestContext
from brain.rbac.visibility import filter_visible_ids

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)

NOW = datetime.now(UTC)


@pytest.fixture(scope="module")
async def owner():
    engine = create_engine(get_settings().database_url_unpooled)
    yield engine
    await engine.dispose()


async def _company(admin, name="PT RBAC"):
    r = await admin.post("/api/tenants", json={"name": name})
    assert r.status_code == 201, r.text
    return uuid.UUID(r.json()["tenant_id"])


async def _roles(admin) -> dict[str, str]:
    return {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}


async def _join(admin, user, role_key):
    roles = await _roles(admin)
    inv = (await admin.post("/api/admin/invites", json={"role_id": roles[role_key]})).json()
    r = await user.post(f"/api/join/{inv['link'].rsplit('/', 1)[1]}")
    assert r.status_code == 200, r.text


def _ctx(tenant_id, business=(), system=(), grants=()) -> RequestContext:
    return RequestContext(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id,
        membership_status="active",
        role_keys=frozenset(),
        role_ids=frozenset([*business, *system]),
        business_role_ids=frozenset(business),
        temp_grant_container_ids=frozenset(grants),
        permission_version=1,
    )


def _item(tenant_id, container_id, item_id, **kw) -> SourceItem:
    return SourceItem(
        tenant_id=tenant_id,
        id=item_id,
        type="doc",
        source="upload",
        container_id=container_id,
        external_ref=item_id,
        created_at=NOW,
        updated_at=NOW,
        raw_text=item_id,
        **kw,
    )


# --- visibility rule ----------------------------------------------------------------------


@pytest.fixture
async def world(make_user):
    """Containers/items covering every branch of visible(item, user)."""
    admin = await make_user("Admin")
    t = await _company(admin)
    async with tenant_session(t) as s:
        roles = {r.key: r.id for r in await s.scalars(select(Role))}
        c = {
            name: Container(
                tenant_id=t, source="upload_folder", external_id=name, name=name, mapped=mapped
            )
            for name, mapped in [
                ("open_staff", True),
                ("unmapped", False),
                ("no_acl", True),
                ("gated", True),
            ]
        }
        s.add_all(c.values())
        await s.flush()
        s.add_all(
            [
                ContainerAcl(tenant_id=t, container_id=c["open_staff"].id, role_id=roles["staff"]),
                ContainerAcl(tenant_id=t, container_id=c["unmapped"].id, role_id=roles["staff"]),
                ContainerAcl(tenant_id=t, container_id=c["gated"].id, role_id=roles["finance"]),
                # A system role in an ACL must never grant content (only possible via direct SQL).
                ContainerAcl(tenant_id=t, container_id=c["no_acl"].id, role_id=roles["admin"]),
            ]
        )
        s.add_all(
            [
                _item(t, c["open_staff"].id, "DOC-sop"),
                _item(t, c["open_staff"].id, "DOC-secret-in-open"),
                _item(t, c["open_staff"].id, "DOC-deleted", deleted_at=NOW),
                _item(t, c["unmapped"].id, "CHAT-new-channel-1"),
                _item(t, c["no_acl"].id, "DOC-no-acl"),
                _item(t, c["no_acl"].id, "DOC-allowed-for-new-hire"),
                _item(t, c["gated"].id, "DOC-grade-gaji"),
            ]
        )
        await s.flush()
        s.add_all(
            [
                ItemAclOverride(
                    tenant_id=t, item_id="DOC-secret-in-open", role_id=roles["staff"], effect="deny"
                ),
                ItemAclOverride(
                    tenant_id=t, item_id="DOC-secret-in-open", role_id=roles["ops"], effect="allow"
                ),
                ItemAclOverride(
                    tenant_id=t,
                    item_id="DOC-allowed-for-new-hire",
                    role_id=roles["new_hire"],
                    effect="allow",
                ),
            ]
        )
    return t, roles, {k: v.id for k, v in c.items()}


ALL_IDS = [
    "DOC-sop", "DOC-secret-in-open", "DOC-deleted", "CHAT-new-channel-1", "DOC-no-acl",
    "DOC-allowed-for-new-hire", "DOC-grade-gaji", "DOC-does-not-exist",
]  # fmt: skip


async def _visible(ctx) -> set[str]:
    async with tenant_session(ctx.tenant_id) as s:
        return await filter_visible_ids(s, ctx, ALL_IDS)


async def test_staff_sees_mapped_acl_items_only(world):
    t, roles, _ = world
    assert await _visible(_ctx(t, [roles["staff"]])) == {"DOC-sop"}


async def test_deny_override_beats_allow(world):
    t, roles, _ = world
    # staff (deny) + ops (allow) on the same item: deny wins.
    assert await _visible(_ctx(t, [roles["staff"], roles["ops"]])) == {"DOC-sop"}
    # ops alone: allow override applies even though ops isn't in the container ACL.
    assert await _visible(_ctx(t, [roles["ops"]])) == {"DOC-secret-in-open"}


async def test_allow_override_in_container_without_acl(world):
    t, roles, _ = world
    assert await _visible(_ctx(t, [roles["new_hire"]])) == {"DOC-allowed-for-new-hire"}


async def test_unmapped_container_invisible_even_with_acl(world):
    """T25 at the rule level: a new channel is invisible to everyone until mapped."""
    t, roles, _ = world
    every_role = [roles[k] for k in roles if k not in ("owner", "admin", "auditor")]
    assert "CHAT-new-channel-1" not in await _visible(_ctx(t, every_role))


async def test_system_roles_grant_no_content(world):
    t, roles, _ = world
    assert (
        await _visible(_ctx(t, system=[roles["owner"], roles["admin"], roles["auditor"]])) == set()
    )


async def test_temp_grant_opens_container(world):
    t, roles, c = world
    assert await _visible(_ctx(t, [roles["staff"]], grants=[c["gated"]])) == {
        "DOC-sop",
        "DOC-grade-gaji",
    }


async def test_no_roles_sees_nothing(world):
    t, _, _ = world
    assert await _visible(_ctx(t)) == set()


# --- admin API ----------------------------------------------------------------------------


async def test_container_default_deny_and_mapping(make_user):
    admin = await make_user("Admin")
    await _company(admin)
    roles = await _roles(admin)
    r = await admin.post(
        "/api/admin/containers", json={"source": "upload_folder", "name": "Paket Onboarding"}
    )
    assert r.status_code == 201
    cid, v0 = r.json()["id"], r.json()["permission_version"]

    unmapped = (await admin.get("/api/admin/containers?unmapped_only=true")).json()
    created = next(c for c in unmapped if c["id"] == cid)
    assert created["tier"] == "hidden" and created["mapped"] is False and created["role_ids"] == []

    bad = await admin.patch(f"/api/admin/containers/{cid}", json={"role_ids": [roles["admin"]]})
    assert bad.status_code == 422 and bad.json()["detail"] == "system_role_not_allowed"

    ok = await admin.patch(
        f"/api/admin/containers/{cid}",
        json={"tier": "open", "mapped": True, "role_ids": [roles["staff"], roles["new_hire"]]},
    )
    assert ok.status_code == 200 and ok.json()["permission_version"] == v0 + 1
    mapped = next(c for c in (await admin.get("/api/admin/containers")).json() if c["id"] == cid)
    assert mapped["mapped"] and sorted(mapped["role_ids"]) == sorted(
        [roles["staff"], roles["new_hire"]]
    )

    assert (
        await admin.post("/api/admin/containers", json={"source": "slack_channel", "name": "x"})
    ).status_code == 422  # integration containers come from integrations, not by hand


async def test_role_crud_and_system_roles_immutable(make_user):
    admin = await make_user()
    await _company(admin)
    roles = await _roles(admin)
    r = await admin.post("/api/admin/roles", json={"key": "ops_makassar", "name": "Ops Makassar"})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert (
        await admin.post("/api/admin/roles", json={"key": "ops_makassar", "name": "x"})
    ).status_code == 409
    assert (
        await admin.patch(f"/api/admin/roles/{rid}", json={"name": "Ops Cabang Makassar"})
    ).status_code == 200
    assert (
        await admin.patch(f"/api/admin/roles/{roles['admin']}", json={"name": "x"})
    ).status_code == 409
    assert (await admin.delete(f"/api/admin/roles/{roles['owner']}")).status_code == 409
    assert (await admin.delete(f"/api/admin/roles/{rid}")).status_code == 200
    assert "ops_makassar" not in await _roles(admin)


async def test_member_roles_guards_and_self_grant_audit(make_user, owner):
    boss = await make_user("Owner")
    t = await _company(boss)
    roles = await _roles(boss)
    helper = await make_user("Helper admin")
    await _join(boss, helper, "staff")

    # Owner makes helper an admin.
    r = await boss.put(
        f"/api/admin/members/{helper.user_id}/roles",
        json={"roles": [{"role_id": roles["admin"]}, {"role_id": roles["staff"]}]},
    )
    assert r.status_code == 200
    # A non-owner admin can't hand out (or take away) the owner role.
    r = await helper.put(
        f"/api/admin/members/{helper.user_id}/roles", json={"roles": [{"role_id": roles["owner"]}]}
    )
    assert r.status_code == 403 and r.json()["detail"] == "owner_required"
    # The last owner can't drop their own owner role.
    r = await boss.put(
        f"/api/admin/members/{boss.user_id}/roles", json={"roles": [{"role_id": roles["admin"]}]}
    )
    assert r.status_code == 409 and r.json()["detail"] == "last_owner"

    # Admin grants *themselves* HR: allowed, but flagged for the auditor (4.1).
    r = await helper.put(
        f"/api/admin/members/{helper.user_id}/roles",
        json={"roles": [{"role_id": roles["admin"]}, {"role_id": roles["hr"]}]},
    )
    assert r.status_code == 200
    async with owner.connect() as c:
        details = await c.scalar(
            text(
                "SELECT details FROM audit_log WHERE tenant_id = :t "
                "AND details->>'action' = 'member.roles.set' ORDER BY seq DESC LIMIT 1"
            ),
            {"t": t},
        )
    assert details["self_grant"] is True and details["after"] == ["admin", "hr"]

    # An already-expired role grant is not a principal.
    past = (NOW - timedelta(minutes=1)).isoformat()
    await boss.put(
        f"/api/admin/members/{helper.user_id}/roles",
        json={"roles": [{"role_id": roles["staff"]}, {"role_id": roles["hr"], "expires_at": past}]},
    )
    assert (await helper.get("/api/context")).json()["roles"] == ["staff"]


async def test_topics_managers_pii(make_user):
    admin = await make_user()
    await _company(admin)
    roles = await _roles(admin)
    cid = (
        await admin.post("/api/admin/containers", json={"source": "upload_folder", "name": "FIN"})
    ).json()["id"]
    sari = await make_user("Sari")
    await _join(admin, sari, "hr")

    gated = {"display_name": "Grade gaji", "fallback_contact": "HR Helpdesk", "tier": "gated"}
    assert (await admin.put("/api/admin/topics/grade_gaji", json=gated)).status_code == 422
    r = await admin.put(
        "/api/admin/topics/grade_gaji",
        json={
            **gated,
            "container_id": cid,
            "owner_user_id": sari.user_id,
            "aliases": ["salary grade"],
        },
    )
    assert r.status_code == 200
    topics = (await admin.get("/api/admin/topics")).json()
    assert topics[0]["topic_key"] == "grade_gaji" and topics[0]["aliases"] == ["salary grade"]

    r = await admin.post(
        "/api/admin/managers",
        json={"scope_type": "container", "scope_id": cid, "manager_user_id": sari.user_id},
    )
    assert r.status_code == 201
    stranger = str(uuid.uuid4())
    r = await admin.post(
        "/api/admin/managers",
        json={"scope_type": "department", "scope_id": "HR", "manager_user_id": stranger},
    )
    assert r.status_code == 404

    assert (
        await admin.put(f"/api/admin/pii/{roles['staff']}", json={"pii_types": ["phone"]})
    ).status_code == 200
    assert (
        await admin.put(f"/api/admin/pii/{roles['admin']}", json={"pii_types": ["nik"]})
    ).status_code == 422
    pii = (await admin.get("/api/admin/pii")).json()
    assert pii[roles["staff"]] == ["phone"] and "nik" in pii[roles["hr"]]


async def test_audit_chain_verifies_and_detects_tampering(make_user, owner):
    admin = await make_user()
    t = await _company(admin)
    for i in range(3):
        await admin.post("/api/admin/roles", json={"key": f"role_{i}", "name": f"Role {i}"})
    async with tenant_session(t) as s:
        check = await audit.verify_chain(s)
        events = (
            await s.scalars(select(AuditLog.details["action"].astext).order_by(AuditLog.seq))
        ).all()
    assert check.ok and check.rows == 4
    assert events == ["tenant.create", "role.create", "role.create", "role.create"]

    # Someone with owner privileges edits history: the chain breaks at that row.
    async with owner.begin() as c:
        await c.execute(
            text(
                "UPDATE audit_log SET details = details || CAST(:patch AS jsonb) "
                "WHERE tenant_id = :t AND seq = 3"
            ),
            {"t": t, "patch": '{"key": "x"}'},
        )
    async with tenant_session(t) as s:
        check = await audit.verify_chain(s)
    assert not check.ok and check.first_bad_seq == 3
