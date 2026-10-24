"""Document repository (folders, list, new version, delete, original-file rule), fake embedder."""

import pytest
from botocore.exceptions import ClientError

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

POLICY = b"# Gaji\n\n## 1. Struktur\nDirektur: 100 juta rupiah per bulan."
POLICY_V2 = b"# Gaji\n\n## 1. Struktur\nDirektur: 120 juta rupiah per bulan."
WITH_NIK = b"# Data Karyawan\n\n## 1. Identitas\nNIK Dimas: 3171012501990003"


@pytest.fixture(autouse=True)
def fake_ingestor():
    app.dependency_overrides[get_ingestor] = lambda: Ingestor(FakeEmbedder(), DictionaryExtractor())
    yield
    app.dependency_overrides.pop(get_ingestor, None)


@pytest.fixture
async def org(make_user):
    admin = await make_user("Admin")
    await admin.post("/api/tenants", json={"name": "PT Dokumen"})
    roles = {r["key"]: r["id"] for r in (await admin.get("/api/admin/roles")).json()}

    async def member(role):
        u = await make_user(role)
        inv = (await admin.post("/api/admin/invites", json={"role_id": roles[role]})).json()
        await u.post(f"/api/join/{inv['link'].rsplit('/', 1)[1]}")
        return u

    async def folder(name, mapped_roles=()):
        cid = (
            await admin.post(
                "/api/admin/containers", json={"source": "upload_folder", "name": name}
            )
        ).json()["id"]
        if mapped_roles:
            await admin.patch(f"/api/admin/containers/{cid}",
                              json={"mapped": True, "tier": "gated", "role_ids": [roles[r] for r in mapped_roles]})  # fmt: skip
        return cid

    return admin, member, folder, roles


async def _upload(user, cid, name, data):
    r = await user.post("/api/uploads", data={"container_id": cid}, files={"file": (name, data)})
    assert r.status_code == 201, r.text
    return r.json()


async def test_folders_and_listing_follow_visibility(org):
    admin, member, folder, _ = org
    hr_folder = await folder("Kompensasi", ["hr"])
    nobody = await folder("Belum dipetakan")
    await _upload(admin, hr_folder, "gaji.md", POLICY)
    await _upload(admin, nobody, "draft.md", POLICY)
    hr, staff = await member("hr"), await member("staff")

    by_name = {f["name"]: f for f in (await admin.get("/api/documents/folders")).json()}
    assert by_name["Kompensasi"]["role_names"] and by_name["Kompensasi"]["document_count"] == 1
    # An unmapped folder is listed for admins, with nobody able to read it: the UI warns about it.
    assert (
        by_name["Belum dipetakan"]["mapped"] is False
        and by_name["Belum dipetakan"]["role_names"] == []
    )

    hr_folders = (await hr.get("/api/documents/folders")).json()
    assert [f["name"] for f in hr_folders] == ["Kompensasi"] and hr_folders[0]["can_upload"]
    docs = (await hr.get("/api/documents")).json()
    assert [d["id"] for d in docs] == ["DOC-gaji"] and docs[0]["can_read"] and docs[0]["can_manage"]
    assert docs[0]["uploaded_by"] == "Admin"  # the uploader is recorded as the author

    assert (await staff.get("/api/documents/folders")).json() == []
    assert (await staff.get("/api/documents")).json() == []
    assert (await staff.get("/api/documents/DOC-gaji")).status_code == 404

    # Admins see the metadata of every upload but no content without a business role (4.1).
    admin_docs = {d["filename"]: d for d in (await admin.get("/api/documents")).json()}
    assert set(admin_docs) == {"gaji.md", "draft.md"} and not admin_docs["draft.md"]["can_read"]


async def test_new_version_keeps_id_and_replaces_text_and_file(org):
    admin, member, folder, _ = org
    cid = await folder("Kompensasi", ["hr"])
    first = await _upload(admin, cid, "gaji.md", POLICY)
    hr = await member("hr")

    r = await hr.put("/api/documents/DOC-gaji/file", files={"file": ("gaji-2026.md", POLICY_V2)})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["id"] == "DOC-gaji" and doc["revisions"] == 2 and doc["filename"] == "gaji.md"
    text = " ".join(c["text"] for c in (await hr.get("/api/sources/DOC-gaji")).json()["chunks"])
    assert "120 juta" in text and "100 juta" not in text
    with pytest.raises(ClientError):  # the previous original is removed from storage
        await storage.get_object(first["storage_key"])


async def test_delete_removes_from_search_and_needs_manage_rights(org):
    admin, member, folder, _ = org
    cid = await folder("Umum", ["staff", "hr"])
    up = await _upload(admin, cid, "gaji.md", POLICY)
    staff, hr = await member("staff"), await member("hr")

    assert (await staff.get("/api/documents/DOC-gaji")).json()["can_manage"] is False
    assert (await staff.delete("/api/documents/DOC-gaji")).status_code == 403
    assert (await hr.delete("/api/documents/DOC-gaji")).status_code == 204
    assert (await hr.get("/api/sources/DOC-gaji")).status_code == 404
    assert (await hr.get("/api/documents")).json() == []
    with pytest.raises(ClientError):
        await storage.get_object(up["storage_key"])


async def test_original_file_only_when_its_personal_data_is_allowed(org):
    admin, member, folder, roles = org
    cid = await folder("HR Data", ["hr"])
    await _upload(admin, cid, "data-karyawan.md", WITH_NIK)
    hr = await member("hr")
    await admin.put(
        f"/api/admin/pii/{roles['hr']}", json={"pii_types": []}
    )  # new tenants grant HR all types

    doc = (await hr.get("/api/documents/DOC-data-karyawan")).json()
    assert doc["has_pii"] and doc["can_download"] is False
    assert (await hr.get("/api/documents/DOC-data-karyawan/original")).status_code == 403
    assert (await hr.get("/api/sources/DOC-data-karyawan")).json()["download_url"] is None

    await admin.put(f"/api/admin/pii/{roles['hr']}", json={"pii_types": ["nik"]})
    assert (await hr.get("/api/documents/DOC-data-karyawan")).json()["can_download"] is True
    link = (await hr.get("/api/documents/DOC-data-karyawan/original")).json()
    assert link["url"].startswith("http") and link["filename"] == "data-karyawan.md"


async def test_company_profile_is_known_to_every_member(org):
    admin, member, _, _ = org
    staff = await member("staff")
    await admin.patch("/api/admin/tenant", json={"profile": "Berdiri sejak 2020 di Jakarta."})
    r = await staff.get("/api/sources/COMPANY-profile")
    assert r.status_code == 200
    text = r.json()["chunks"][0]["text"]
    assert "PT Dokumen" in text and "Berdiri sejak 2020" in text
    assert (await admin.get("/api/admin/tenant")).json()[
        "profile"
    ] == "Berdiri sejak 2020 di Jakarta."
