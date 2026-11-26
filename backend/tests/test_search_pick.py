"""Which chunks of the fused search results are kept (no DB)."""

from types import SimpleNamespace

from brain.retrieval import search
from brain.retrieval.search import NO_PII, _pick


def _row(item: str, anchor: str, text: str):
    chunk = SimpleNamespace(
        anchor=anchor, text_masked=text, text_raw=text, context_text=f"{item} › {anchor}"
    )
    src = SimpleNamespace(id=item, type="doc", source="upload", title=item, author_display=None, created_at=None,
                          updated_at=None, authority="official_doc", injection_flag=False, url=None, structured=None)  # fmt: skip
    return SimpleNamespace(Chunk=chunk, SourceItem=src, container="HR", score=0.0)


def _ids(rows, entities, limit=6):
    return [h.citation_id for h in _pick(rows, NO_PII, limit, entities)]


ROWS = [
    _row("DOC-dir", "1", "Nomor HP pribadi hanya untuk keadaan mendesak."),
    _row("DOC-dir", "0", "Data demo. Pemilik topik: HR."),
    _row("DOC-kontak", "1", "Kontak layanan umum."),
    _row(
        "DOC-dir", "5", "| Budi Hartono | ... | Rina  Wulandari | Staf Operasional | 0813****7766 |"
    ),
    _row("DOC-etik", "2", "Kode etik."),
]


def test_without_entities_the_order_and_cap_are_unchanged():
    assert _ids(ROWS, []) == ["DOC-dir#1", "DOC-dir#0", "DOC-kontak#1", "DOC-etik#2"]


def test_a_named_persons_chunk_takes_its_items_slot():
    # Same items, same positions; DOC-dir's lower slot now holds the row that names Rina.
    assert _ids(ROWS, ["Rina Wulandari"]) == [
        "DOC-dir#1",
        "DOC-dir#5",
        "DOC-kontak#1",
        "DOC-etik#2",
    ]


def test_chunks_that_name_the_person_are_not_replaced():
    rows = [
        ROWS[3],
        _row("DOC-dir", "6", "Rina Wulandari, ext. 140"),
        _row("DOC-dir", "7", "Rina Wulandari lagi"),
    ]
    assert _ids(rows, ["Rina Wulandari"]) == ["DOC-dir#5", "DOC-dir#6"]


def test_no_new_items_once_full():
    rows = [ROWS[0], ROWS[2], _row("DOC-lain", "1", "Rina Wulandari")]
    assert _ids(rows, ["Rina Wulandari"], limit=2) == ["DOC-dir#1", "DOC-kontak#1"]


def test_cap_is_still_two_per_item():
    assert search.MAX_CHUNKS_PER_ITEM == 2
