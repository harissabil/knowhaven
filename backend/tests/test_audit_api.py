"""Auditor API (design doc 4.4 E, 14.2, T26) on top of the stub pipeline."""

import uuid

import pytest
from sqlalchemy import text

from brain.config import get_settings
from brain.db.engine import create_engine
from tests.test_pipeline import collect, ctx_of, final, org, pipeline  # noqa: F401  (org is a fixture)

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)


@pytest.fixture
async def audited(org, make_user):  # noqa: F811
    tenant_id, admin, people = org
    lina = await make_user("Lina")
    roles = {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}
    inv = (await admin.post("/api/admin/invites", json={"role_id": roles["staff"]})).json()
    await lina.post(f"/api/join/{inv['link'].rsplit('/', 1)[1]}")
    await admin.put(
        f"/api/admin/members/{lina.user_id}/roles", json={"roles": [{"role_id": roles["auditor"]}]}
    )
    ctx = await ctx_of(tenant_id, people["Dimas"])
    kenari = final(await collect(pipeline(), ctx, "Proyek Kenari itu apa?"))
    bensin = final(await collect(pipeline(), ctx, "Uang bensin per bulan berapa?"))
    return tenant_id, admin, people, lina, kenari, bensin


async def test_only_auditors_read_the_log(audited):
    _, admin, people, lina, _, _ = audited
    assert (await people["Dimas"].get("/api/audit/log")).json() == {"detail": "auditor_required"}
    assert (
        await admin.get("/api/audit/log")
    ).status_code == 403  # owner/admin configure, don't audit
    rows = (await lina.get("/api/audit/log?event_type=query")).json()
    assert [r["decision_path"] for r in rows[:2]] == ["conflict", "idk"]  # newest first
    assert (
        rows[0]["actor_name"] == "Dimas" and rows[0]["prompt_version"] and rows[0]["latency_ms"] > 0
    )


async def test_query_detail_shows_filtered_ids_but_no_content(audited):
    _, _, _, lina, kenari, bensin = audited
    d = (await lina.get(f"/api/audit/queries/{kenari['query_id']}")).json()
    assert d["audit"]["decision_path"] == "idk" and d["audit"]["filtered_count"] > 0
    assert [t["step"] for t in d["trace"]] == [1, 2, 3, 4, 5, 6, 7, 8]
    retrieve = next(t for t in d["trace"] if t["name"] == "retrieve")
    filtered_ids = {i for call in retrieve["detail"]["tool_calls"] for i in call["filtered_ids"]}
    assert "CHAT-proyek-kenari-0001" in filtered_ids  # the auditor sees WHICH item was filtered

    b = (await lina.get(f"/api/audit/queries/{bensin['query_id']}")).json()
    claims = next(t for t in b["trace"] if t["name"] == "evidence")["detail"]["claims"]
    assert (
        claims
        and all("statement" not in c for c in claims)
        and all("citation_id" in c for c in claims)
    )
    assert (await lina.get(f"/api/audit/queries/{uuid.uuid4()}")).status_code == 404


async def test_verify_detects_tampering_and_is_itself_recorded(audited):
    tenant_id, _, _, lina, _, bensin = audited
    ok = (await lina.post("/api/audit/verify")).json()
    assert ok["ok"] and ok["rows"] > 5
    last = (await lina.get("/api/audit/log?limit=1")).json()[0]
    assert last["event_type"] == "audit" and last["details"]["action"] == "audit.verify"

    owner = create_engine(get_settings().database_url_unpooled)
    async with owner.begin() as c:  # someone with DB-owner rights rewrites an answer
        await c.execute(text("UPDATE audit_log SET response_text = 'Rp1.000.000' WHERE tenant_id = :t AND query_id = :q"),
                        {"t": tenant_id, "q": uuid.UUID(bensin["query_id"])})  # fmt: skip
    await owner.dispose()
    bad = (await lina.post("/api/audit/verify")).json()
    assert not bad["ok"] and bad["first_bad_seq"] is not None


async def test_summary_and_user_trace(audited):
    _, _, people, lina, kenari, _ = audited
    s = (await lina.get("/api/audit/summary")).json()
    assert s["queries"] >= 2 and s["by_decision"]["idk"] >= 1 and s["total_filtered"] > 0

    mine = (await people["Dimas"].get(f"/api/queries/{kenari['query_id']}/trace")).json()
    assert [t["step"] for t in mine] == [1, 2, 3, 4, 5, 6, 7, 8] and all(
        t["detail"] is None for t in mine
    )
    assert (
        "sumber yang bisa Anda akses" in next(t for t in mine if t["name"] == "retrieve")["summary"]
    )
    other = await people["Sari"].get(f"/api/queries/{kenari['query_id']}/trace")
    unknown = await people["Sari"].get(f"/api/queries/{uuid.uuid4()}/trace")
    assert other.status_code == unknown.status_code == 404 and other.json() == unknown.json()
