"""Retrieval quality on the seeded demo data (brain-seed) with real query embeddings.

Run: uv run pytest tests/test_retrieval_seed.py -m live -s
"""

import pytest
from sqlalchemy import func, select, text

from brain.config import get_settings
from brain.db.models import User
from brain.db.session import global_session, tenant_session
from brain.rbac.context import load_context
from brain.retrieval.tools import Retriever

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not get_settings().google_api_key, reason="no GOOGLE_API_KEY"),
]

KENARI = ("CHAT-proyek-kenari", "DOC-project-charter-kenari", "TASK-KNR")


async def persona(email: str, slug: str = "srn") -> Retriever:
    async with global_session() as s:
        # No tenant is set here, so RLS hides `tenants`; the lookup function returns the slug.
        tenant_id = await s.scalar(
            text(
                "SELECT tenant_id FROM list_my_memberships((SELECT id FROM users WHERE email = :e)) WHERE tenant_slug = :s"
            ),
            {"e": email, "s": slug},
        )
        user_id = await s.scalar(select(User.id).where(func.lower(User.email) == email))
    if tenant_id is None:
        pytest.skip("demo seed not loaded: run `uv run brain-seed`")
    async with tenant_session(tenant_id) as s:
        return Retriever(await load_context(s, tenant_id, user_id))


def ids(res) -> list[str]:
    return [h.citation_id for h in res.hits]


def report(r: Retriever) -> None:
    for c in r.calls:
        print(f"  {c.tool}({c.args}) {c.ms} ms -> {c.returned_ids[:4]} filtered={c.filtered_count}")


async def test_bensin_id_and_en():
    r = await persona("dimas@srn-demo.id")
    msgs = await r.search_messages("Uang bensin per bulan berapa?")
    docs = await r.search_documents("Uang bensin per bulan berapa?")
    en = await r.search_messages("What's the monthly fuel allowance?")
    print()
    report(r)
    assert "CHAT-pengumuman-hr-0002" in ids(msgs)[:3]
    assert "DOC-sop-reimbursement#3" in ids(docs)[:3]
    assert "CHAT-pengumuman-hr-0002" in ids(en)[:3]


async def test_mixed_language_leave_question():
    r = await persona("dimas@srn-demo.id")
    docs = await r.search_documents("Cuti tahunan brp hari ya for probation?")
    assert "DOC-kebijakan-cuti#2" in ids(docs)[:3]


async def test_kenari_hidden_for_new_hire_visible_for_pm():
    dimas, andi = await persona("dimas@srn-demo.id"), await persona("andi@srn-demo.id")
    for q in ("Proyek Kenari itu apa?", "What is the Kenary project?"):
        for tool in ("search_messages", "search_documents"):
            res = await getattr(dimas, tool)(q)
            assert not any(h.item_id.startswith(KENARI) for h in res.hits), (q, tool, ids(res))
    assert (await dimas.query_tasks(entity="Kenari")).hits == []
    assert (
        sum(c.filtered_count for c in dimas.calls) > 0
    )  # the auditor can see something was filtered
    pm = await andi.search_messages("Proyek Kenari itu apa?")
    assert any(h.item_id.startswith("CHAT-proyek-kenari") for h in pm.hits)


async def test_makassar_story_across_sources():
    r = await persona("rina@srn-demo.id")
    msgs = await r.search_messages("Kenapa stok telat di Makassar?", entities=["Makassar"])
    docs = await r.search_documents("prosedur eskalasi keterlambatan pengiriman")
    tasks = await r.query_tasks(entity="Makassar", status="open")
    print()
    report(r)
    assert any(
        i.startswith(("CHAT-ops-makassar", "CHAT-wa-tim-gudang-makassar")) for i in ids(msgs)[:3]
    )
    assert "DOC-sop-distribusi#4.2" in ids(docs)[:3]
    assert ids(tasks) == ["TASK-OPS-118", "TASK-OPS-121", "TASK-OPS-125"]
    # Dimas has no OPS access: same task query returns nothing.
    assert (
        await (await persona("dimas@srn-demo.id")).query_tasks(entity="Makassar", status="open")
    ).hits == []


async def test_cross_tenant_isolation_klm():
    wulan = await persona("wulan@klm-demo.id", "klm")
    kenari = await wulan.search_messages("Proyek Kenari itu apa?")
    assert not any(h.item_id.startswith(KENARI) for h in kenari.hits)
    assert kenari.filtered_count == 0  # SRN data isn't even a filtered candidate: RLS
    kenanga = await wulan.query_tasks(entity="Kenanga")
    assert ids(kenanga) == ["TASK-KLM-3"]
