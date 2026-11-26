"""Applying an approved amount change to Confluence page XHTML (no DB, no network)."""

import pytest

from brain.hitl.executors import ExecutionError, apply_to_storage
from brain.policy.conflict import replace_amount

PAGE = (
    "<h2>2. Ruang Lingkup</h2><p>Batas Rp500.000 per bulan berlaku umum.</p>"
    "<h2>3. Jenis Biaya yang Dapat Diklaim</h2><table><tbody>"
    "<tr><th><p>Jenis biaya</p></th><th><p>Batas</p></th></tr>"
    "<tr><td><p>Uang bensin bulanan</p></td><td><p><strong>Rp500.000 per bulan</strong></p></td></tr>"
    "<tr><td><p>Makan lembur</p></td><td><p>Rp50.000 per hari</p></td></tr>"
    "</tbody></table><h2>4. Prosedur</h2><p>Rp500.000</p>"
)
# The chunk as indexed: the table flattened, which never appears in the XHTML.
OLD = "|  Jenis biaya  |  Batas  |\n\n|  Uang bensin bulanan  |  Rp500.000 per bulan  |\n\n|  Makan lembur  |  Rp50.000 per hari  |"


def _draft(new_text=None):
    new = new_text if new_text is not None else replace_amount(OLD, 500_000, 750_000)[0]
    return {"old_text": OLD, "new_text": new, "old_value": "Rp500.000", "new_value": "Rp750.000"}


def test_replace_amount_keeps_the_space_after_the_amount():
    assert replace_amount("Rp500.000 per bulan", 500_000, 600_000) == ("Rp600.000 per bulan", 1)
    assert replace_amount("500 rb sebulan", 500_000, 600_000) == ("Rp600.000 sebulan", 1)


def test_table_change_lands_in_the_target_section_only():
    out = apply_to_storage(PAGE, _draft(), "3. Jenis Biaya yang Dapat Diklaim")
    assert "<strong>Rp750.000 per bulan</strong>" in out
    assert "Batas Rp500.000 per bulan berlaku umum" in out  # section 2 untouched
    assert out.endswith("<h2>4. Prosedur</h2><p>Rp500.000</p>")  # section 4 untouched
    assert "Rp50.000 per hari" in out


def test_drafts_saved_without_the_space_still_apply():
    legacy = OLD.replace("Rp500.000 per bulan", "Rp750.000per bulan")
    out = apply_to_storage(PAGE, _draft(legacy), "3. Jenis Biaya yang Dapat Diklaim")
    assert "<strong>Rp750.000 per bulan</strong>" in out


def test_plain_paragraph_still_uses_the_exact_text():
    page = "<h2>Bensin</h2><p>Uang bensin Rp500.000 per bulan.</p>"
    p = {
        "old_text": "Uang bensin Rp500.000 per bulan.",
        "new_text": "Uang bensin Rp750.000 per bulan.",
        "old_value": "Rp500.000",
        "new_value": "Rp750.000",
    }
    assert (
        apply_to_storage(page, p, "Bensin")
        == "<h2>Bensin</h2><p>Uang bensin Rp750.000 per bulan.</p>"
    )


@pytest.mark.parametrize(
    "draft, heading",
    [
        (
            _draft(OLD.replace("Rp500.000 per bulan", "Rp750.000 per minggu")),
            "3. Jenis Biaya yang Dapat Diklaim",
        ),  # approver rewrote
        (_draft(), "9. Tidak Ada"),  # section gone from the page
        (_draft(), None),  # whole page: three Rp500.000, the draft changed one
    ],
)
def test_anything_but_the_exact_amount_change_fails(draft, heading):
    with pytest.raises(ExecutionError, match="text_not_found_in_page"):
        apply_to_storage(PAGE, draft, heading)
