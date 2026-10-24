"""MCP server end to end (design doc 13, T22-T24, T33): a real uvicorn server, the MCP SDK client,
a personal token from the web API, and the stub pipeline from test_pipeline."""

import asyncio
import socket
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from sqlalchemy import select

from brain.config import get_settings
from brain.db.models import AuditLog
from brain.db.session import tenant_session
from brain.mcp_server import server as mcp_server
from brain.retrieval.tools import NOT_FOUND
from tests.test_pipeline import org, pipeline  # noqa: F401  (org is a fixture)

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
async def mcp_url(monkeypatch):
    monkeypatch.setattr(mcp_server, "PIPELINE_FACTORY", pipeline)  # stub LLM steps, fake embedder
    port = _free_port()
    srv = uvicorn.Server(
        uvicorn.Config(mcp_server.create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    task = asyncio.create_task(srv.serve())
    while not srv.started:  # noqa: ASYNC110 - uvicorn exposes a flag, not an event
        await asyncio.sleep(0.05)
    yield f"http://127.0.0.1:{port}/mcp"
    srv.should_exit = True
    await task


@asynccontextmanager
async def session(url: str, token: str):
    hc = create_mcp_http_client(headers={"Authorization": f"Bearer {token}"})
    async with hc, streamable_http_client(url, http_client=hc) as streams:
        async with ClientSession(streams[0], streams[1]) as s:
            await s.initialize()
            yield s


async def call(s: ClientSession, tool: str, **args) -> str:
    res = await s.call_tool(tool, args, read_timeout_seconds=120)
    assert not getattr(res, "is_error", False) and not getattr(res, "isError", False), res
    return "".join(getattr(c, "text", "") for c in res.content)


async def _token(user) -> dict:
    r = await user.post("/api/settings/workbuddy/tokens", json={"label": "laptop"})
    assert r.status_code == 201, r.text
    return r.json()


async def test_tools_answers_and_identity(org, mcp_url):  # noqa: F811
    tenant_id, _, people = org
    tok = await _token(people["Dimas"])
    assert tok["token"].startswith("wbk_") and '"Authorization": "Bearer wbk_' in tok["mcp_json"]

    async with session(mcp_url, tok["token"]) as s:
        tools = {t.name for t in (await s.list_tools()).tools}
        assert tools == {"ask_workplace_brain", "open_source", "whoami"}  # read + ask only (13.2)

        who = await call(s, "whoami")
        assert "Dimas" in who and "PT Pipeline" in who and "staff" in who

        answer = await call(s, "ask_workplace_brain", question="Uang bensin per bulan berapa?")
        assert (
            "Rp750.000" in answer and "Sumber:" in answer and "[CHAT-pengumuman-hr-0001]" in answer
        )

        kenari = await call(s, "ask_workplace_brain", question="Proyek Kenari itu apa?")
        assert kenari.startswith('Saya tidak menemukan informasi tentang "Proyek Kenari"')

        hidden = await call(s, "open_source", item_id="CHAT-proyek-kenari-0001")
        missing = await call(s, "open_source", item_id="CHAT-tidak-ada-0001")
        assert hidden == missing == NOT_FOUND  # T24
        assert "Rp500.000" in await call(s, "open_source", item_id="DOC-sop-reimbursement#3")

    async with tenant_session(tenant_id) as db:
        rows = (
            await db.scalars(select(AuditLog.channel).where(AuditLog.event_type == "query"))
        ).all()
    assert rows.count("mcp") == 2


async def test_role_change_applies_and_removal_revokes(org, mcp_url):  # noqa: F811
    _, admin, people = org
    dimas = people["Dimas"]
    tok = (await _token(dimas))["token"]
    roles = {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}

    async with session(mcp_url, tok) as s:
        assert "staff" in await call(s, "whoami")
        # T23: change roles in the web app; the very next MCP call sees it (no new token).
        await admin.put(f"/api/admin/members/{dimas.user_id}/roles",
                        json={"roles": [{"role_id": roles["staff"]}, {"role_id": roles["ops"]}]})  # fmt: skip
        assert "ops, staff" in await call(s, "whoami")

    # T33: removed member -> token revoked -> rejected before MCP even starts.
    assert (await admin.delete(f"/api/admin/members/{dimas.user_id}")).status_code == 204
    async with httpx.AsyncClient() as h:
        r = await h.post(mcp_url, headers={"Authorization": f"Bearer {tok}"}, json={})
    assert r.status_code == 401 and r.json()["error"] == "invalid_token"


async def test_missing_or_bad_token_rejected_and_pending_cannot_create(org, mcp_url, make_user):  # noqa: F811
    _, admin, _ = org
    async with httpx.AsyncClient() as h:
        assert (await h.post(mcp_url, json={})).status_code == 401
        assert (
            await h.post(mcp_url, headers={"Authorization": "Bearer wbk_nope"}, json={})
        ).status_code == 401
        assert (await h.get(mcp_url.replace("/mcp", "/healthz"))).status_code == 200

    code = (await admin.get("/api/admin/join-code")).json()["join_code"]
    pending = await make_user("Pending")
    await pending.post("/api/tenants/join-code", json={"code": code})
    r = await pending.post("/api/settings/workbuddy/tokens", json={"label": "x"})
    assert r.status_code == 403 and r.json()["detail"] == "membership_pending"  # T30


async def test_token_list_and_revoke(org, mcp_url):  # noqa: F811
    _, _, people = org
    sari = people["Sari"]
    tok = await _token(sari)
    listed = (await sari.get("/api/settings/workbuddy/tokens")).json()
    assert [t["id"] for t in listed] == [tok["id"]] and "token" not in listed[0]
    assert (await sari.delete(f"/api/settings/workbuddy/tokens/{tok['id']}")).status_code == 204
    async with httpx.AsyncClient() as h:
        r = await h.post(mcp_url, headers={"Authorization": f"Bearer {tok['token']}"}, json={})
    assert r.status_code == 401
    assert (await sari.delete(f"/api/settings/workbuddy/tokens/{uuid.uuid4()}")).status_code == 404
