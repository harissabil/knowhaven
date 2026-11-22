"""Havi's system sources about Knowhaven itself: app-guide articles and the asker's ME-access."""

from pathlib import Path

import pytest

from brain import guide
from brain.policy import validate
from brain.rbac.capabilities import AUDIENCES, Caps

STAFF = Caps()
HR = Caps(upload=True, pii=frozenset({"nik", "npwp"}))
APPROVER = Caps(approve=True, upload=True)
AUDITOR = Caps(audit=True)
ADMIN = Caps(admin=True, upload=True, approve=True)
FRONTEND_APP = Path(__file__).resolve().parents[2] / "frontend" / "src" / "app"


def test_articles_are_well_formed():
    assert len(guide.ARTICLES) >= 15
    for a in guide.ARTICLES.values():
        assert a.id.startswith("HELP-") and a.audience in AUDIENCES, a.id
        assert a.title and a.body and len(a.aliases) >= 4, a.id
        assert all(x == x.lower() for x in a.aliases), a.id  # matched against lowercased text


@pytest.mark.skipif(not FRONTEND_APP.exists(), reason="frontend not checked out")
def test_every_article_points_at_a_real_page():
    for a in guide.ARTICLES.values():
        assert (FRONTEND_APP / a.page.strip("/") / "page.tsx").exists(), (a.id, a.page)


@pytest.mark.parametrize(
    ("question", "caps", "allowed", "denied"),
    [
        ("bagaimana cara undang karyawan?", ADMIN, ["HELP-members-invites"], []),
        ("bagaimana cara undang karyawan?", STAFF, [], ["HELP-members-invites"]),
        # Indonesian affixes: "mengundang", "mengupload", "diundang".
        (
            "bagaimana cara mengundang karyawan baru ke knowhaven?",
            STAFF,
            [],
            ["HELP-members-invites"],
        ),
        (
            "bagaimana cara mengundang karyawan baru ke knowhaven?",
            ADMIN,
            ["HELP-members-invites"],
            [],
        ),
        ("gimana cara mengupload dokumen?", HR, ["HELP-upload"], []),
        ("karyawan yang diundang statusnya apa?", ADMIN, ["HELP-members-invites"], []),
        ("cara upload dokumen gimana", HR, ["HELP-upload"], []),
        ("cara upload dokumen gimana", STAFF, [], ["HELP-upload"]),
        ("how do i verify the hash chain in the audit log?", AUDITOR, ["HELP-audit"], []),
        ("how do i verify the hash chain in the audit log?", STAFF, [], ["HELP-audit"]),
        ("menu persetujuan isinya apa?", APPROVER, ["HELP-approvals"], []),
        ("i'm new here, what should i know?", STAFF, ["HELP-getting-started"], []),
        ("cara minta akses ke topik terbatas?", STAFF, ["HELP-request-access"], []),
        # Company questions never pull app articles, and never produce a "not available" note.
        ("siapa yang approve reimburse di atas rp5 juta?", STAFF, [], []),
        ("uang bensin per bulan berapa?", STAFF, [], []),
        ("kebijakan cuti karyawan baru?", STAFF, [], []),
        ("ringkas diskusi channel slack ops", STAFF, [], []),
        ("what can i do with my role?", STAFF, [], []),  # answered from ME-access alone
    ],
)
def test_articles_follow_the_role(question, caps, allowed, denied):
    got_allowed, got_denied = guide.match([question], caps)
    assert [a.id for a in got_allowed] == allowed
    assert [a.id for a in got_denied] == denied


def test_readable_hides_articles_outside_the_role():
    assert guide.readable("HELP-members-invites", ADMIN) is not None
    assert guide.readable("HELP-members-invites", STAFF) is None
    assert guide.readable("HELP-does-not-exist", ADMIN) is None
    assert guide.readable("HELP-getting-started", STAFF) is not None


def _access(caps, denied=()):
    return guide.access_text(name="Dimas", company="PT Uji", roles=["Staff"], caps=caps,
                             folders=["HR", "Umum"], folder_total=2, contact="HR Helpdesk", denied=denied)  # fmt: skip


def test_access_lists_only_what_the_role_can_do():
    staff = _access(STAFF)
    assert "Peran Anda / Your roles: Staff" in staff and "Folders you can read: HR, Umum" in staff
    for admin_only in (
        "menu Undangan",
        "menu Anggota",
        "menu Integrasi",
        "menu Upload Data",
        "Audit Log",
    ):
        assert admin_only not in staff, admin_only
    assert "Tidak tersedia" not in staff  # nothing about what the role can't do unless asked

    admin = _access(ADMIN)
    assert "menu Undangan" in admin and "menu Integrasi" in admin and "menu Persetujuan" in admin
    assert "Audit Log" not in admin  # admin is not auditor

    hr = _access(HR)
    assert "menu Upload Data" in hr and "NIK" in hr and "NPWP" in hr and "menu Undangan" not in hr


def test_access_names_only_the_feature_asked_about():
    asked = guide.ARTICLES["HELP-members-invites"]
    text = _access(STAFF, denied=[asked])
    assert f"Not available for your role: {asked.title}. Hubungi / Contact: HR Helpdesk" in text
    assert text.count("Tidak tersedia") == 1


def test_access_caps_long_folder_lists():
    text = guide.access_text(name=None, company="PT", roles=[], caps=STAFF, folders=["A", "B"],
                             folder_total=14, contact="x")  # fmt: skip
    assert "Folders you can read: A, B (+12)" in text and "Nama" not in text


@pytest.mark.parametrize("cid", ["ME-access", "HELP-members-invites", "COMPANY-profile"])
def test_system_sources_are_citations(cid):
    v = validate.validate(
        f"Anda bisa mengundang karyawan lewat menu Undangan [{cid}].", {cid: "x"}, "q"
    )
    assert v.ok and v.citations == [cid], v.problems


def test_system_source_must_be_retrieved_and_well_formed():
    not_retrieved = validate.validate(
        "Anda bisa mengundang karyawan lewat menu Undangan [HELP-upload].", {"ME-access": "x"}, "q"
    )
    assert any(p.startswith("unknown_citations") for p in not_retrieved.problems)
    for bad in ("ME-secrets", "HELP-Upload", "HELP-"):
        v = validate.validate(
            f"Anda bisa mengundang karyawan lewat menu Undangan [{bad}].", {bad: "x"}, "q"
        )
        assert "no_citations" in v.problems, bad


def test_system_ids():
    assert guide.is_system_id("ME-access") and guide.is_system_id("HELP-upload")
    assert guide.is_system_id("COMPANY-profile") and not guide.is_system_id("DOC-sop-cuti#2")
    assert not guide.is_system_id("HELP-not-an-article")
