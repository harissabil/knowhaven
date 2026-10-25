"""Inline document tags in a question (no database)."""

from brain.agent.mentions import split_mentions


def test_markup_becomes_plain_text_and_ids():
    q = "Ringkas @[SOP Cuti](DOC-kebijakan-cuti) dan @[Matriks](DOC-matriks#1), lalu @[SOP Cuti](DOC-kebijakan-cuti)"
    plain, ids = split_mentions(q)
    assert plain == "Ringkas @SOP Cuti dan @Matriks, lalu @SOP Cuti"
    assert ids == ["DOC-kebijakan-cuti", "DOC-matriks#1"]


def test_text_without_tags_is_untouched_and_odd_brackets_are_not_tags():
    assert split_mentions("Uang bensin berapa?") == ("Uang bensin berapa?", [])
    q = "email ke @budi [lihat](link spasi) atau @[x](bad id with spaces)"
    assert split_mentions(q) == (q, [])
