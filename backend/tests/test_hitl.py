"""Phase 9: Human-in-the-loop tests (design doc 12, 4.5, T06 draft part, T14 access request).

Runs against the linked Neon dev branch using fake embedders (zero LLM cost).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from brain.audit import log as audit
from brain.config import get_settings
from brain.db.models import (
    AccessRequest,
    Container,
    ContainerAcl,
    Role,
    SourceItem,
    TempGrant,
    TopicOwner,
)
from brain.db.session import tenant_session
from brain.hitl import drafts
from brain.ingestion.extract import DictionaryExtractor
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem, Section
from tests.conftest import FakeEmbedder
from tests.test_pipeline import collect, ctx_of, final, org, pipeline  # noqa: F401

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)

NOW = datetime.now(UTC)


@pytest.fixture
async def hitl_env(org, make_user):  # noqa: F811
    tenant_id, admin, people = org
    dimas = people["Dimas"]
    sari = people["Sari"]

    # Setup a gated container and topic for T14
    async with tenant_session(tenant_id) as s:
        role_ids = {r.key: r.id for r in await s.scalars(select(Role))}
        gated_box = Container(
            tenant_id=tenant_id,
            source="upload_folder",
            external_id="GAJI-BOX",
            name="Dokumen Gaji",
            tier="gated",
            mapped=True,
            owner_user_id=uuid.UUID(sari.user_id),
        )
        s.add(gated_box)
        await s.flush()
        s.add(
            ContainerAcl(
                tenant_id=tenant_id, container_id=gated_box.id, role_id=role_ids["hr"]
            )
        )
        s.add(
            TopicOwner(
                tenant_id=tenant_id,
                topic_key="grade_gaji",
                display_name="Grade Gaji & Kompensasi",
                fallback_contact="hr@srn.example",
                owner_user_id=uuid.UUID(sari.user_id),
                tier="gated",
                container_id=gated_box.id,
            )
        )
        s.add(
            TopicOwner(
                tenant_id=tenant_id,
                topic_key="uang_bensin",
                display_name="Uang Bensin & Transportasi",
                fallback_contact="hr@srn.example",
                owner_user_id=uuid.UUID(sari.user_id),
                tier="open",
            )
        )
        hr_c = await s.scalar(
            select(Container).where(
                Container.tenant_id == tenant_id, Container.external_id == "HR"
            )
        )
        if hr_c:
            hr_c.owner_user_id = uuid.UUID(sari.user_id)

    # Ingest a document into the gated box
    doc = IngestItem(
        source="upload",
        container_external_id="GAJI-BOX",
        container_name="Dokumen Gaji",
        external_ref="GAJI/grade",
        type="doc",
        text="",
        sections=[Section("1", "Tabel Grade Gaji", "Grade 3: Rp10.000.000 - Rp15.000.000.")],
        title="Standar Grade Gaji",
        id_hint="standar-grade-gaji",
        created_at=NOW - timedelta(days=30),
        updated_at=NOW - timedelta(days=30),
    )
    await Ingestor(FakeEmbedder(), DictionaryExtractor()).ingest(tenant_id, [doc])

    return tenant_id, admin, dimas, sari, gated_box.id


async def test_access_request_lifecycle_and_security(hitl_env):
    tenant_id, admin, dimas, sari, gated_box_id = hitl_env

    # 1. Dimas (staff) cannot request a non-existent or hidden topic
    r = await dimas.post(
        "/api/approvals/access-requests",
        json={"topic_key": "topik_palsu", "reason": "Coba-coba"},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "topic_not_requestable"

    # 2. Dimas requests access to the gated topic "grade_gaji"
    r = await dimas.post(
        "/api/approvals/access-requests",
        json={"topic_key": "grade_gaji", "reason": "Perlu cek grade tim"},
    )
    assert r.status_code == 201, r.text
    req_data = r.json()
    req_id = req_data["id"]
    assert req_data["status"] == "pending"
    assert req_data["topic_key"] == "grade_gaji"
    assert req_data["requester_id"] == dimas.user_id

    # 3. Duplicate request while pending fails
    r_dup = await dimas.post(
        "/api/approvals/access-requests",
        json={"topic_key": "grade_gaji", "reason": "Minta lagi"},
    )
    assert r_dup.status_code == 409
    assert r_dup.json()["detail"] == "request_already_pending"

    # 4. Requester cannot approve their own request
    r_self = await dimas.post(
        f"/api/approvals/access-requests/{req_id}/approve", json={"days": 7}
    )
    assert r_self.status_code == 403
    assert r_self.json()["detail"] == "self_approval_forbidden"

    # 5. Dimas sees his own request in mine=true
    mine = (await dimas.get("/api/approvals/access-requests?mine=true")).json()
    assert any(x["id"] == req_id for x in mine)

    # 6. Sari (topic owner) sees the pending request
    sari_reqs = (await sari.get("/api/approvals/access-requests")).json()
    assert any(x["id"] == req_id for x in sari_reqs)

    # 7. Sari approves the request for 7 days
    r_app = await sari.post(
        f"/api/approvals/access-requests/{req_id}/approve", json={"days": 7}
    )
    assert r_app.status_code == 200, r_app.text
    assert r_app.json()["status"] == "approved"
    assert r_app.json()["approver_id"] == sari.user_id

    # 8. Check TempGrant in DB and permission version bumped
    async with tenant_session(tenant_id) as s:
        grant = await s.scalar(
            select(TempGrant).where(TempGrant.access_request_id == uuid.UUID(req_id))
        )
        assert grant is not None
        assert grant.user_id == uuid.UUID(dimas.user_id)
        assert grant.container_id == gated_box_id

    # 9. Now Dimas already has access; requesting again returns already_has_access
    r_again = await dimas.post(
        "/api/approvals/access-requests",
        json={"topic_key": "grade_gaji", "reason": "Minta lagi"},
    )
    assert r_again.status_code == 409
    assert r_again.json()["detail"] == "already_has_access"


async def test_access_request_rejection(hitl_env, make_user):
    tenant_id, admin, dimas, sari, _ = hitl_env
    andi = await make_user("Andi")
    roles = {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}
    inv = (await admin.post("/api/admin/invites", json={"role_id": roles["staff"]})).json()
    await andi.post(f"/api/join/{inv['link'].rsplit('/', 1)[1]}")

    # Andi requests access
    r = await andi.post(
        "/api/approvals/access-requests",
        json={"topic_key": "grade_gaji", "reason": "Mau lihat gaji bos"},
    )
    assert r.status_code == 201
    req_id = r.json()["id"]

    # Sari rejects with a note
    r_rej = await sari.post(
        f"/api/approvals/access-requests/{req_id}/reject",
        json={"note": "Bukan wewenang Anda"},
    )
    assert r_rej.status_code == 200
    assert r_rej.json()["status"] == "rejected"

    # Approving an already decided request fails
    r_late = await sari.post(
        f"/api/approvals/access-requests/{req_id}/approve", json={"days": 3}
    )
    assert r_late.status_code == 409
    assert r_late.json()["detail"] == "already_decided"


async def test_action_draft_lifecycle_and_execution(hitl_env):
    tenant_id, admin, dimas, sari, _ = hitl_env

    # 1. Ask bensin question -> conflict creates ActionDraft
    ctx = await ctx_of(tenant_id, dimas)
    events = await collect(pipeline(), ctx, "Uang bensin per bulan berapa?")
    f = final(events)
    assert f["decision_path"] == "conflict"
    assert f["action_draft_ids"]
    draft_id = f["action_draft_ids"][0]

    # 2. Dimas (staff) is not an approver for HR SOP
    assert (await dimas.get("/api/approvals/drafts")).json() == []
    r_dimas = await dimas.get(f"/api/approvals/drafts/{draft_id}")
    assert r_dimas.status_code == 404
    assert r_dimas.json()["detail"] == "draft_not_found"

    # 3. Sari (HR / topic owner) can see the draft
    sari_drafts = (await sari.get("/api/approvals/drafts")).json()
    assert any(d["id"] == draft_id for d in sari_drafts)
    d = (await sari.get(f"/api/approvals/drafts/{draft_id}")).json()
    assert d["status"] == "pending"
    assert d["payload"]["old_value"] == "Rp500.000"
    assert d["payload"]["new_value"] == "Rp750.000"
    assert "Rp500.000" in d["diff"] and "Rp750.000" in d["diff"]

    # 4. Sari edits the draft (e.g. to Rp800.000)
    r_edit = await sari.patch(
        f"/api/approvals/drafts/{draft_id}", json={"new_value": "Rp800.000"}
    )
    assert r_edit.status_code == 200
    d_edited = r_edit.json()
    assert d_edited["payload"]["new_value"] == "Rp800.000"
    assert "Rp800.000" in d_edited["diff"]

    # 5. Sari approves the draft -> executes update on internal copy
    r_app = await sari.post(f"/api/approvals/drafts/{draft_id}/approve")
    assert r_app.status_code == 200, r_app.text
    d_done = r_app.json()
    assert d_done["status"] == "executed"
    assert d_done["approver_id"] == sari.user_id
    assert d_done["exec_result"]["item_id"] == "DOC-sop-reimbursement"
    assert d_done["exec_result"]["new_version"] == 2

    # 6. Verify that the document in DB was updated to version 2 with new text
    async with tenant_session(tenant_id) as s:
        item = await s.scalar(
            select(SourceItem).where(SourceItem.id == "DOC-sop-reimbursement")
        )
        assert item.version == 2
        chain = await audit.verify_chain(s)
        assert chain.ok

    # 7. Approving again fails (already decided)
    r_again = await sari.post(f"/api/approvals/drafts/{draft_id}/approve")
    assert r_again.status_code == 409
    assert r_again.json()["detail"] == "already_decided"


async def test_draft_rejection(hitl_env):
    tenant_id, _, dimas, sari, _ = hitl_env
    ctx = await ctx_of(tenant_id, dimas)

    # Force propose a new draft manually for testing rejection
    async with tenant_session(tenant_id) as s:
        mock_candidates = [
            {
                "topic": "uang_bensin",
                "chosen": {"citation_id": "CHAT-pengumuman-hr-0001", "value": "Rp900.000"},
                "competing": [{"citation_id": "DOC-sop-reimbursement#3", "value": "Rp500.000"}],
                "stale_doc_ids": ["DOC-sop-reimbursement"],
            }
        ]
        draft_ids = await drafts.propose(s, ctx, uuid.uuid4(), mock_candidates)
        assert draft_ids
        did = draft_ids[0]

    # Sari rejects the draft
    r_rej = await sari.post(
        f"/api/approvals/drafts/{did}/reject", json={"note": "Belum ada persetujuan direksi"}
    )
    assert r_rej.status_code == 200
    assert r_rej.json()["status"] == "rejected"


async def test_grant_expiration(hitl_env):
    tenant_id, admin, dimas, sari, _ = hitl_env

    # Dimas requests access
    r = await dimas.post(
        "/api/approvals/access-requests",
        json={"topic_key": "grade_gaji", "reason": "Tes masa berlaku"},
    )
    req_id = r.json()["id"]

    # Sari approves for 1 day
    await sari.post(f"/api/approvals/access-requests/{req_id}/approve", json={"days": 1})

    # Manually expire it by setting expires_at in the past
    async with tenant_session(tenant_id) as s:
        req = await s.scalar(
            select(AccessRequest).where(AccessRequest.id == uuid.UUID(req_id))
        )
        req.expires_at = datetime.now(UTC) - timedelta(hours=1)

    # Trigger expire-grants endpoint
    r_exp = await admin.post("/api/approvals/expire-grants")
    assert r_exp.status_code == 200
    assert r_exp.json()["expired_count"] >= 1

    # Verify status changed to expired
    async with tenant_session(tenant_id) as s:
        req = await s.scalar(
            select(AccessRequest).where(AccessRequest.id == uuid.UUID(req_id))
        )
        assert req.status == "expired"
