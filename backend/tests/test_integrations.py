"""Slack + Atlassian integrations (design doc 15; T20, T21, T25, T31) against mocked APIs."""

import hashlib
import hmac
import json
import time
import uuid

import httpx
import pytest
from sqlalchemy import select

from brain.api.uploads import get_ingestor
from brain.config import get_settings
from brain.db.models import ActionDraft, Container, SourceItem
from brain.db.session import tenant_session
from brain.hitl import executors
from brain.ingestion.extract import DictionaryExtractor
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem, Section
from brain.integrations import atlassian, slack, store, sync
from brain.main import app
from tests.conftest import FakeEmbedder

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)
SECRET = "test-signing-secret"


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    st = get_settings()
    monkeypatch.setattr(st, "slack_client_id", "cid")
    monkeypatch.setattr(st, "slack_client_secret", "csecret")
    monkeypatch.setattr(st, "slack_signing_secret", SECRET)
    app.dependency_overrides[get_ingestor] = lambda: Ingestor(FakeEmbedder(), DictionaryExtractor())
    yield
    app.dependency_overrides.pop(get_ingestor, None)
    slack.default_transport = atlassian.default_transport = None


def _ingestor():
    return Ingestor(FakeEmbedder(), DictionaryExtractor())


async def _company(make_user, name):
    admin = await make_user("Admin")
    r = await admin.post("/api/tenants", json={"name": name})
    return admin, uuid.UUID(r.json()["tenant_id"])


def _signed(body: dict, ts: int | None = None, secret: str = SECRET) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    ts = ts or int(time.time())
    sig = "v0=" + hmac.new(secret.encode(), f"v0:{ts}:".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {
        "X-Slack-Request-Timestamp": str(ts),
        "X-Slack-Signature": sig,
        "Content-Type": "application/json",
    }


async def _post_event(user, body: dict, **kw):
    raw, headers = _signed(body, **kw)
    return await user.client.post("/api/integrations/slack/events", content=raw, headers=headers)


def test_signature_rules():
    raw, h = _signed({"a": 1})
    ts, sig = h["X-Slack-Request-Timestamp"], h["X-Slack-Signature"]
    get_settings().slack_signing_secret = SECRET
    assert slack.verify(raw, ts, sig)
    assert not slack.verify(raw + b" ", ts, sig)  # tampered body
    assert not slack.verify(raw, ts, sig.replace("a", "b", 1) if "a" in sig else sig[:-1] + "0")
    old_raw, old = _signed({"a": 1}, ts=int(time.time()) - 600)
    assert not slack.verify(
        old_raw, old["X-Slack-Request-Timestamp"], old["X-Slack-Signature"]
    )  # replay


def test_oauth_state_is_single_use_and_bound_to_the_session():
    t, u, sess = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    st = slack.make_state(t, u, sess)
    with pytest.raises(slack.SlackError, match="state_other_session"):
        slack.read_state(st, uuid.uuid4())
    assert slack.read_state(st, sess) == (t, u)
    with pytest.raises(slack.SlackError, match="state_reused"):
        slack.read_state(st, sess)
    with pytest.raises(slack.SlackError, match="bad_state"):
        slack.read_state(st[:-2] + "xx", sess)


async def test_slack_events_follow_workspace_and_default_deny(make_user):
    admin_a, tenant_a = await _company(make_user, "PT Slack A")
    _, tenant_b = await _company(make_user, "PT Slack B")
    team_a, team_b = f"TA{uuid.uuid4().hex[:8]}", f"TB{uuid.uuid4().hex[:8]}"
    await store.upsert(tenant_a, "slack", team_a, {"bot_token": "xoxb-a"}, None, {"workspace": "A"})
    await store.upsert(tenant_b, "slack", team_b, {"bot_token": "xoxb-b"}, None, {"workspace": "B"})
    slack.default_transport = httpx.MockTransport(
        lambda r: httpx.Response(
            200,
            json={
                "ok": True,
                "channel": {"name": "pengumuman-baru"},
                "user": {"name": "sari", "profile": {"display_name": "Sari"}},
            },
        )
    )

    # url_verification needs a valid signature; a bad one is refused
    raw, h = _signed({"type": "url_verification", "challenge": "abc"})
    r = await admin_a.client.post("/api/integrations/slack/events", content=raw, headers=h)
    assert r.json() == {"challenge": "abc"}
    h["X-Slack-Signature"] = "v0=bad"
    assert (
        await admin_a.client.post("/api/integrations/slack/events", content=raw, headers=h)
    ).status_code == 401

    ts = f"{time.time():.6f}"
    msg = {
        "type": "message",
        "channel": "C0NEW1",
        "user": "U1",
        "text": "Mulai 1 November uang makan Rp50.000",
        "ts": ts,
    }
    r = await _post_event(admin_a, {"type": "event_callback", "team_id": team_a, "event": msg})
    assert r.status_code == 200
    async with tenant_session(tenant_a) as s:
        item = await s.scalar(select_item(f"C0NEW1:{ts}"))
        c = (
            await s.execute(
                select(Container.mapped, Container.tier).where(Container.external_id == "C0NEW1")
            )
        ).one()
    assert item is not None and item.deleted_at is None
    assert tuple(c) == (False, "hidden")  # T25: a new channel is visible to nobody until mapped
    async with tenant_session(tenant_b) as s:
        assert await s.scalar(select_item(f"C0NEW1:{ts}")) is None  # T31: only tenant A got it

    # unknown workspace: acknowledged and dropped (T31)
    r = await _post_event(admin_a, {"type": "event_callback", "team_id": "TUNKNOWN", "event": msg})
    assert r.json().get("dropped") == "unknown_workspace"

    # message_deleted removes it from answers (T21)
    await _post_event(
        admin_a,
        {
            "type": "event_callback",
            "team_id": team_a,
            "event": {
                "type": "message",
                "subtype": "message_deleted",
                "channel": "C0NEW1",
                "deleted_ts": ts,
            },
        },
    )
    async with tenant_session(tenant_a) as s:
        assert (await s.scalar(select_item(f"C0NEW1:{ts}"))).deleted_at is not None


def select_item(ref: str):
    return select(SourceItem).where(SourceItem.source == "slack", SourceItem.external_ref == ref)


def _atlassian_mock(
    pages: dict[str, tuple[str, str, int]], token_ok: bool = True, calls: list | None = None
):
    """pages: id -> (title, storage, version) in space HR; plus one Jira project OPS with one issue."""
    site = "https://acme-test.atlassian.net"

    def handler(req: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append((req.method, req.url.path, req.content))
        if not token_ok:
            return httpx.Response(401, json={})
        p = req.url.path
        if p == "/rest/api/3/myself":
            return httpx.Response(200, json={"displayName": "Team SRN", "accountId": "acc1"})
        if p == "/wiki/api/v2/spaces":
            return httpx.Response(
                200, json={"results": [{"id": "100", "key": "HR", "name": "HR"}], "_links": {}}
            )
        if p == "/wiki/api/v2/spaces/100/pages":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": pid,
                            "title": t,
                            "createdAt": "2026-10-01T02:00:00Z",
                            "version": {"number": v, "createdAt": "2026-10-20T02:00:00Z"},
                            "body": {"storage": {"value": body}},
                            "_links": {"webui": f"/spaces/HR/pages/{pid}"},
                        }
                        for pid, (t, body, v) in pages.items()
                    ],
                    "_links": {},
                },
            )
        if p.startswith("/wiki/api/v2/pages/") and req.method == "GET":
            pid = p.rsplit("/", 1)[1]
            t, body, v = pages[pid]
            return httpx.Response(
                200,
                json={
                    "id": pid,
                    "title": t,
                    "createdAt": "2026-10-01T02:00:00Z",
                    "version": {"number": v, "createdAt": "2026-10-20T02:00:00Z"},
                    "body": {"storage": {"value": body}},
                    "_links": {"webui": f"/spaces/HR/pages/{pid}"},
                },
            )
        if p.startswith("/wiki/api/v2/pages/") and req.method == "PUT":
            pid = p.rsplit("/", 1)[1]
            data = json.loads(req.content)
            pages[pid] = (data["title"], data["body"]["value"], data["version"]["number"])
            return httpx.Response(200, json={"id": pid})
        if p == "/rest/api/3/project/search":
            return httpx.Response(
                200, json={"values": [{"key": "OPS", "name": "Operasional"}], "isLast": True}
            )
        if p == "/rest/api/3/search/jql":
            return httpx.Response(
                200,
                json={
                    "issues": [
                        {
                            "key": "OPS-1",
                            "fields": {
                                "project": {"key": "OPS", "name": "Operasional"},
                                "summary": "Kapal Makassar telat",
                                "status": {
                                    "name": "In Progress",
                                    "statusCategory": {"key": "indeterminate"},
                                },
                                "labels": ["pic-rina", "cabang-makassar"],
                                "created": "2026-10-20T09:00:00.000+0700",
                                "updated": "2026-10-21T09:00:00.000+0700",
                            },
                        }
                    ],
                    "isLast": True,
                },
            )
        return httpx.Response(404, json={})

    return site, httpx.MockTransport(handler)


SOP_V1 = "<h1>SOP Reimbursement</h1><h2>3. Uang Bensin</h2><p>Rp500.000 per bulan.</p>"


async def test_atlassian_connect_sync_adopt_and_delete(make_user):
    admin, tenant = await _company(make_user, "PT Atlassian")
    # Imported earlier from files: same space key + same page title as the live page.
    await _ingestor().ingest(
        tenant,
        [
            IngestItem(
                source="confluence",
                container_external_id="HR",
                container_name="HR",
                external_ref="HR/sop-reimbursement",
                type="doc",
                text="",
                sections=[Section("3", "3. Uang Bensin", "Rp500.000 per bulan.")],
                title="SOP Reimbursement",
                id_hint="sop-reimbursement",
                created_at=_now(),
                updated_at=_now(),
                url="https://srn-demo.atlassian.net/x",
            )
        ],
    )
    pages = {
        "9001": ("SOP Reimbursement", SOP_V1, 4),
        "9002": ("Kebijakan Cuti", "<h1>Kebijakan Cuti</h1><p>12 hari.</p>", 1),
    }
    site, transport = _atlassian_mock(pages)
    atlassian.default_transport = transport

    bad_site, bad = _atlassian_mock({}, token_ok=False)
    atlassian.default_transport = bad
    r = await admin.post(
        "/api/admin/integrations/atlassian",
        json={"site_url": "acme-test", "email": "t@x.id", "api_token": "x" * 20},
    )
    assert r.status_code == 400 and r.json()["detail"]["reason"] == "bad_credentials"

    atlassian.default_transport = transport
    r = await admin.post(
        "/api/admin/integrations/atlassian",
        json={
            "site_url": "acme-test.atlassian.net",
            "email": "t@x.id",
            "api_token": "secret-token-1234",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["spaces"] == ["HR"] and r.json()["projects"] == ["OPS"]

    report = await sync.sync_atlassian(tenant, _ingestor())
    assert "error" not in report["confluence"] and report["jira"]["issues"] == 1
    async with tenant_session(tenant) as s:
        sop = await s.scalar(select(SourceItem).where(SourceItem.external_ref == "9001"))
        issue = await s.scalar(select(SourceItem).where(SourceItem.external_ref == "OPS-1"))
    assert sop.id == "DOC-sop-reimbursement" and sop.url.startswith(
        site
    )  # adopted: citation ID kept
    assert issue.structured["assignee"] == "Rina" and issue.type == "task"

    listing = (await admin.get("/api/admin/integrations")).json()
    conf = next(i for i in listing["integrations"] if i["type"] == "confluence")
    assert conf["meta"]["token_hint"] == "••••1234" and "token" not in json.dumps(listing).replace(
        "token_hint", ""
    )

    # page removed in Confluence → no longer cited
    pages.pop("9002")
    await sync.sync_atlassian(tenant, _ingestor())
    async with tenant_session(tenant) as s:
        gone = await s.scalar(select(SourceItem).where(SourceItem.external_ref == "9002"))
    assert gone.deleted_at is not None

    # approved SOP draft is written to the live page as the next version
    calls: list = []
    site, transport = _atlassian_mock(pages, calls=calls)
    atlassian.default_transport = transport
    draft = ActionDraft(id=uuid.uuid4(), tenant_id=tenant, kind="update_sop", target_system="confluence", target_ref="9001",
                        payload={"item_id": "DOC-sop-reimbursement", "base_version": 4, "anchor": "3",
                                 "old_text": "Rp500.000 per bulan.", "new_text": "Rp750.000 per bulan."},
                        diff="", evidence_ids=[], status="approved")  # fmt: skip
    res = await executors.execute(draft, tenant, _ingestor())
    assert res["mode"] == "confluence" and res["new_version"] == 5
    put = next(c for c in calls if c[0] == "PUT")
    assert b"Rp750.000" in put[2] and json.loads(put[2])["version"]["number"] == 5
    assert pages["9001"][2] == 5

    # stale draft (page edited in Confluence since) is refused
    pages["9001"] = (pages["9001"][0], pages["9001"][1], 9)
    with pytest.raises(executors.ExecutionError, match="target_changed_since_draft"):
        draft.payload = {
            **draft.payload,
            "base_version": 5,
            "old_text": "Rp750.000 per bulan.",
            "new_text": "Rp800.000 per bulan.",
        }
        await executors.execute(draft, tenant, _ingestor())


def _now():
    from datetime import UTC, datetime

    return datetime.now(UTC)


async def test_one_site_cannot_feed_two_companies(make_user):
    _, t1 = await _company(make_user, "PT Satu")
    _, t2 = await _company(make_user, "PT Dua")
    site = f"https://dup{uuid.uuid4().hex[:6]}.atlassian.net"
    await store.upsert(t1, "confluence", site, {"site": site}, None, {})
    with pytest.raises(store.WorkspaceTaken):
        await store.upsert(t2, "confluence", site, {"site": site}, None, {})


def test_storage_round_trip_keeps_section_anchors():
    from brain.ingestion.connectors.documents import parse_markdown

    md = "# SOP\n\n## 3. Uang Bensin\nRp500.000 per bulan.\n\n- struk asli\n- maks 30 hari"
    title, sections = parse_markdown(
        atlassian.storage_to_markdown(atlassian.markdown_to_storage(md))
    )
    assert title == "SOP" and any(s.anchor == "3" and "Rp500.000" in s.text for s in sections)
    assert atlassian.normalize_site("ACME") == "https://acme.atlassian.net"
    with pytest.raises(atlassian.AtlassianError):
        atlassian.normalize_site("https://evil.example.com")


def test_adf_panel_macro_plumbing_is_not_content():
    storage = (
        '<ac:adf-extension><ac:adf-node type="panel"><ac:adf-attribute key="panel-type">note</ac:adf-attribute>'
        "<ac:adf-content><p>Data demo sintetis.</p></ac:adf-content></ac:adf-node>"
        '<ac:adf-fallback><div class="panel"><p>Data demo sintetis.</p></div></ac:adf-fallback></ac:adf-extension>'
        "<h2>1. Tujuan</h2><p>Mengatur klaim.</p>"
    )
    md = atlassian.storage_to_markdown(storage)
    assert md.count("Data demo sintetis.") == 1 and "note" not in md and "## 1. Tujuan" in md


async def test_bot_joins_public_channels_but_not_private_ones():
    joined: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        joined.append(dict(httpx.QueryParams(req.content.decode()))["channel"])
        return httpx.Response(200, json={"ok": True})

    chans = [{"id": "C1", "is_member": False}, {"id": "C2", "is_member": True},
             {"id": "G1", "is_private": True, "is_member": False}, {"id": "C3", "is_archived": True}]  # fmt: skip
    n, err = await slack.join_public("xoxb-t", chans, transport=httpx.MockTransport(handler))
    assert (n, err, joined) == (1, None, ["C1"]) and chans[0]["is_member"]

    missing = httpx.MockTransport(
        lambda r: httpx.Response(200, json={"ok": False, "error": "missing_scope"})
    )
    assert await slack.join_public("xoxb-t", [{"id": "C9"}], transport=missing) == (
        0,
        "missing_scope",
    )
