"""Connector parsers (design doc 15). Pure functions, no network."""

import io
import json

from brain.ingestion.chunking import markdown_sections, split_long
from brain.ingestion.connectors import documents, jira, slack, whatsapp

WA_ANDROID = """23/10/26 09.15 - Pesan dan panggilan dienkripsi secara end-to-end.
23/10/26 09.15 - Budi Hartono membuat grup "Tim Gudang Makassar"
23/10/26 09.16 - Rina Wulandari: Stok minyak goreng blm dtg
kapal dari Surabaya ketahan cuaca
23/10/26 09.17 - Budi Hartono: <Media tidak disertakan>
23/10/26 09.18 - Budi Hartono: Ok, eskalasi ke pusat ya
24/10/26 13.02 - Dewi: siap"""

WA_IOS = """[23/10/26 09.16.05] Rina Wulandari: stok telat
[23/10/26 09.17.41] Budi Hartono: ‎image omitted
[23/10/26 09.18.00] Budi Hartono: noted"""

WA_US = """[10/23/26, 9:16:05 AM] Rina: stock is late
[10/23/26, 1:05:00 PM] Budi: ok"""


def test_whatsapp_android_multiline_system_media():
    msgs = whatsapp.parse(WA_ANDROID)
    assert [(m.sender, m.text) for m in msgs] == [
        ("Rina Wulandari", "Stok minyak goreng blm dtg\nkapal dari Surabaya ketahan cuaca"),
        ("Budi Hartono", "Ok, eskalasi ke pusat ya"),
        ("Dewi", "siap"),
    ]
    assert msgs[0].ts.isoformat() == "2026-10-23T09:16:00+07:00"


def test_whatsapp_ios_and_us_locale():
    ios = whatsapp.parse(WA_IOS)
    assert [m.text for m in ios] == ["stok telat", "noted"]
    assert ios[0].ts.second == 5
    us = whatsapp.parse(WA_US)
    assert us[0].ts.month == 10 and us[0].ts.day == 23 and us[1].ts.hour == 13


def test_whatsapp_items_have_unique_refs():
    items = whatsapp.to_items(
        WA_ANDROID + "\n24/10/26 13.02 - Dewi: siap lagi", "wa-gudang", "Tim Gudang"
    )
    refs = [i.external_ref for i in items]
    assert len(refs) == len(set(refs)) == 4
    assert all(i.source == "whatsapp" and i.type == "chat" for i in items)


def test_slack_export(tmp_path):
    (tmp_path / "users.json").write_text(
        json.dumps(
            [
                {
                    "id": "U1",
                    "name": "sari",
                    "real_name": "Sari Kusuma",
                    "profile": {"email": "sari@srn.co.id"},
                }
            ]
        )
    )
    (tmp_path / "channels.json").write_text(json.dumps([{"id": "C1", "name": "pengumuman-hr"}]))
    (tmp_path / "pengumuman-hr").mkdir()
    (tmp_path / "pengumuman-hr" / "2026-09-02.json").write_text(
        json.dumps(
            [
                {"type": "message", "subtype": "channel_join", "user": "U1", "text": "joined", "ts": "1756771200.000100"},
                {"type": "message", "user": "U1", "text": "Halo <!channel>, uang bensin naik jadi *Rp750.000* <@U1>", "ts": "1756782000.000200"},
                {"type": "message", "user": "U1", "text": "detail di <https://wiki.srn/x|SOP>", "ts": "1756782100.000300",
                 "thread_ts": "1756782000.000200", "edited": {"ts": "1756782200.000000"}},
            ]
        )
    )  # fmt: skip
    items, users = slack.load_export(tmp_path)
    assert [i.text for i in items] == [
        "Halo <!channel>, uang bensin naik jadi *Rp750.000* @Sari Kusuma",
        "detail di SOP",
    ]
    first, reply = items
    assert first.external_ref == "C1:1756782000.000200" and first.author_display == "Sari Kusuma"
    assert reply.thread_key == first.thread_key  # same thread → same context window
    assert reply.version == 1756782200  # edited → newer version
    assert users["U1"]["profile"]["email"] == "sari@srn.co.id"


def test_markdown_sections_and_anchors():
    title, sections = markdown_sections(
        "# SOP Reimbursement\n\nBerlaku 2025.\n\n## 3. Uang Bensin\nRp500.000/bulan.\n\n"
        "## 3.1 Syarat\nStruk asli.\n\n## Lampiran Form\nForm A."
    )
    assert title == "SOP Reimbursement"
    assert [(s.anchor, s.heading) for s in sections] == [
        (None, None),
        ("3", "3. Uang Bensin"),
        ("3.1", "3.1 Syarat"),
        ("lampiran-form", "Lampiran Form"),
    ]


def test_split_long_keeps_paragraphs():
    text = "\n\n".join(f"Paragraf {i} " + "kata " * 100 for i in range(10))
    parts = split_long(text, 1500)
    assert len(parts) > 1 and all(len(p) <= 1500 for p in parts)
    assert "".join(parts).count("Paragraf") == 10


def test_split_long_preserves_numbered_lists():
    items = [f"{i}. Langkah prosedur nomor {i} untuk operasional gudang." for i in range(1, 25)]
    text = "\n".join(items)
    parts = split_long(text, 400)
    assert len(parts) > 1
    combined_lines = [ln for p in parts for ln in p.splitlines() if ln.strip()]
    assert combined_lines == items


def test_docx_numbered_list_preservation():
    from docx import Document

    d = Document()
    d.add_heading("SOP Gudang", level=1)
    d.add_paragraph("abc", style="List Number")
    d.add_paragraph("def", style="List Number")
    d.add_paragraph("ghi", style="List Number")
    buf = io.BytesIO()
    d.save(buf)
    title, sections = documents.parse_docx(buf.getvalue())
    assert title == "SOP Gudang"
    assert sections[0].text.splitlines() == ["1. abc", "2. def", "3. ghi"]


def test_docx_headings_and_tables():
    from docx import Document

    d = Document()
    d.add_heading("Tabel Grade Gaji", level=1)
    d.add_heading("1. Ketentuan", level=2)
    d.add_paragraph("Berlaku untuk karyawan tetap.")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "Level", "Gaji pokok"
    t.cell(1, 0).text, t.cell(1, 1).text = "3", "Rp9.500.000"
    buf = io.BytesIO()
    d.save(buf)
    title, sections = documents.parse_docx(buf.getvalue())
    assert title == "Tabel Grade Gaji"
    assert sections[0].anchor == "1" and "karyawan tetap" in sections[0].text
    assert "3 | Rp9.500.000" in sections[-1].text


def _tiny_pdf(pages: list[str]) -> bytes:
    """A minimal valid PDF with one text line per page (no PDF writer dependency)."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for text in pages:
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        page_id, content_id = len(objs) + 1, len(objs) + 2
        kids.append(f"{page_id} 0 R")
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
        )
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode()}\nendstream")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>"
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out


def test_pdf_pages_become_sections():
    _, sections = documents.parse_pdf(_tiny_pdf(["Paket Onboarding", "Cuti tahunan 12 hari"]))
    assert [(s.anchor, s.text) for s in sections] == [
        ("p1", "Paket Onboarding"),
        ("p2", "Cuti tahunan 12 hari"),
    ]


def test_jira_issue_with_adf():
    issue = {
        "key": "OPS-118",
        "fields": {
            "project": {"key": "OPS", "name": "Operasional"},
            "summary": "Stok Makassar telat",
            "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Kapal tertunda cuaca."}]}]},
            "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}},
            "assignee": {"displayName": "Rina Wulandari", "emailAddress": "rina@srn.co.id"},
            "reporter": {"displayName": "Budi Hartono", "emailAddress": "budi@srn.co.id"},
            "priority": {"name": "High"},
            "duedate": "2026-10-30",
            "labels": ["cabang-makassar"],
            "components": [{"name": "Distribusi"}],
            "created": "2026-10-01T09:12:00.000+0700",
            "updated": "2026-10-20T15:00:00.000+0700",
            "comment": {"comments": [{"author": {"displayName": "Budi"}, "body": "Eskalasi ke pusat"}]},
        },
    }  # fmt: skip
    (item,) = jira.issues_to_items({"issues": [issue]}, "https://srn.atlassian.net")
    assert item.id_hint == "OPS-118" and item.url == "https://srn.atlassian.net/browse/OPS-118"
    assert "Kapal tertunda cuaca." in item.text and "Budi: Eskalasi ke pusat" in item.text
    assert (
        item.structured["status_category"] == "indeterminate"
        and item.structured["due"] == "2026-10-30"
    )
    assert item.author_external_id == "budi@srn.co.id"
