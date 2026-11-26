"""Masked values must survive WorkBuddy's Markdown rendering (no DB)."""

import pytest

from brain.mcp_server.server import md_safe

E = "\\*"  # one escaped star


@pytest.mark.parametrize(
    "text, want",
    [
        ("HP Rina **0813****7766** [DOC-x#5].", f"HP Rina **0813{E * 4}7766** [DOC-x#5]."),
        ("already **0812\\*\\*\\*\\*5566**", f"already **0812{E * 4}5566**"),
        ("email r***@gmail.com", f"email r{E * 3}@gmail.com"),
        ("NPWP 12.***.***.*-***.345", f"NPWP 12.{E * 3}.{E * 3}.{E}-{E * 3}.345"),
        ("rekening ******1234", f"rekening {E * 6}1234"),
        ("NIK **3201********0001** milik **Dimas**", f"NIK **3201{E * 8}0001** milik **Dimas**"),
        # Plain bold is left alone.
        (
            "Uang bensin **Rp750.000** per bulan, **berlaku** 1 Okt",
            "Uang bensin **Rp750.000** per bulan, **berlaku** 1 Okt",
        ),
        ("- **Rina Wulandari (Staf):** HP", "- **Rina Wulandari (Staf):** HP"),
        ("**Rp500.000.** selesai", "**Rp500.000.** selesai"),
    ],
)
def test_masked_stars_are_escaped_and_bold_is_kept(text, want):
    assert md_safe(text) == want
