"""Upload endpoint (design doc 4.3 permissions, 15.4 WhatsApp, 15.5 documents), fake embedder."""

import pytest

from brain import storage
from brain.api.uploads import get_ingestor
from brain.config import get_settings
from brain.ingestion.extract import DictionaryExtractor
from brain.ingestion.pipeline import Ingestor
from brain.main import app
from tests.conftest import FakeEmbedder

pytestmark = pytest.mark.skipif(
    not get_settings().app_database_url, reason="Neon env not configured"
)

SOP = b"# SOP Reimbursement\n\n## 3. Uang Bensin\nRp500.000 per bulan.\n\n## 4. Klaim\nStruk asli, maks 30 hari."
WA = b"23/10/26 09.16 - Rina: stok blm dtg\n23/10/26 09.18 - Budi: eskalasi ya"


@pytest.fixture(autouse=True)
def fake_ingestor():
    app.dependency_overrides[get_ingestor] = lambda: Ingestor(FakeEmbedder(), DictionaryExtractor())
    yield
    app.dependency_overrides.pop(get_ingestor, None)


@pytest.fixture
async def org(make_user):
    admin = await make_user("Admin")
    await admin.post("/api/tenants", json={"name": "PT Upload"})
    roles = {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}

    async def member(role):
        u = await make_user(role)
        inv = (await admin.post("/api/admin/invites", json={"role_id": roles[role]})).json()
        await u.post(f"/api/join/{inv['link'].rsplit('/', 1)[1]}")
        return u

    async def folder(source, name, mapped_roles=()):
        cid = (
            await admin.post("/api/admin/containers", json={"source": source, "name": name})
        ).json()["id"]
        if mapped_roles:
            await admin.patch(
                f"/api/admin/containers/{cid}",
                json={"mapped": True, "tier": "open", "role_ids": [roles[r] for r in mapped_roles]},
            )
        return cid

    return admin, member, folder


async def _upload(user, cid, name, data):
    return await user.post("/api/uploads", data={"container_id": cid}, files={"file": (name, data)})


async def test_admin_uploads_markdown_and_original_is_stored(org):
    admin, _, folder = org
    cid = await folder("upload_folder", "SOP HR", ["staff", "hr"])
    r = await _upload(admin, cid, "sop-reimbursement.md", SOP)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] == 1 and body["item_ids"] == ["DOC-sop-reimbursement"]
    assert await storage.get_object(body["storage_key"]) == SOP
    assert body["storage_key"].startswith("tenants/")

    # Re-uploading the same file name with new content = a new version of the same item.
    r2 = await _upload(admin, cid, "sop-reimbursement.md", SOP.replace(b"500.000", b"750.000"))
    assert r2.json()["updated"] == 1 and r2.json()["item_ids"] == ["DOC-sop-reimbursement"]
    for key in (body["storage_key"], r2.json()["storage_key"]):
        await storage.delete_object(key)


async def test_upload_permissions(org):
    admin, member, folder = org
    visible = await folder("upload_folder", "Paket Onboarding", ["hr", "staff"])
    unmapped = await folder("upload_folder", "Belum dipetakan")
    staff, hr = await member("staff"), await member("hr")

    r = await _upload(staff, visible, "x.md", SOP)
    assert (
        r.status_code == 403 and r.json()["detail"] == "upload_not_allowed"
    )  # staff can't upload (4.3)
    r = await _upload(hr, visible, "onboarding.md", b"# Onboarding\n\nSelamat datang.")
    assert r.status_code == 201
    await storage.delete_object(r.json()["storage_key"])
    r = await _upload(hr, unmapped, "x.md", SOP)
    assert r.status_code == 404  # HR can't add to a folder nobody (including HR) can see yet


async def test_whatsapp_export_and_file_type_checks(org):
    admin, _, folder = org
    wa = await folder("whatsapp_group", "Tim Gudang Makassar", ["staff"])
    r = await _upload(admin, wa, "WhatsApp Chat with Tim Gudang.txt", WA)
    assert r.status_code == 201 and r.json()["created"] == 2
    assert r.json()["item_ids"] == [
        "CHAT-wa-tim-gudang-makassar-0001",
        "CHAT-wa-tim-gudang-makassar-0002",
    ]
    await storage.delete_object(r.json()["storage_key"])

    assert (await _upload(admin, wa, "notulen.md", SOP)).status_code == 415
    docs = await folder("upload_folder", "Docs", ["staff"])
    assert (await _upload(admin, docs, "virus.exe", b"MZ")).status_code == 415
    assert (await _upload(admin, docs, "broken.pdf", b"not a pdf")).status_code == 422
