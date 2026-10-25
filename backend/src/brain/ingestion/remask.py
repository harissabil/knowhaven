"""Recompute stored masking from the raw text, after the PII detector or the company's email
domains change (design doc 11.4). Masked text is what search and the model see, so it must follow
the current rules, not the ones in force when an item was ingested.

    brain-remask --admin admin@srn-demo.id --tenant srn

Only text changes: chunk embeddings were computed from the masked text and stay as they are (a few
masked characters barely move a vector). Lexical search follows automatically (tsv is generated).
"""

import argparse
import asyncio
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Chunk, SourceItem
from brain.db.session import global_session, tenant_session
from brain.ingestion import pii
from brain.tenancy import domains as company_domains


async def remask(s: AsyncSession) -> dict:
    """Tenant-scoped session. Returns how many chunks / items changed."""
    domains = await company_domains.for_tenant(s)
    chunks = items = 0
    for c in await s.scalars(select(Chunk)):
        masked = pii.mask_text(c.text_raw, domains)[0]
        # Context windows are stored masked only; masking again catches what the old rules missed.
        ctx = pii.mask_text(c.context_text, domains)[0] if c.context_text else c.context_text
        if (masked, ctx) != (c.text_masked, c.context_text):
            c.text_masked, c.context_text = masked, ctx
            chunks += 1
    for it in await s.scalars(select(SourceItem).where(SourceItem.raw_text.is_not(None))):
        spans = [sp.as_dict() for sp in pii.detect(it.raw_text, domains)]
        if spans != (it.pii_spans or []):
            it.pii_spans = spans
            items += 1
    await s.flush()
    return {"chunks": chunks, "items": items}


async def run(admin_email: str, tenant_slug: str) -> dict:
    async with global_session() as s:
        row = (await s.execute(text(
            "SELECT m.tenant_id FROM users u, LATERAL list_my_memberships(u.id) m "
            "WHERE lower(u.email) = lower(:e) AND m.tenant_slug = :t AND m.status = 'active'"),
            {"e": admin_email, "t": tenant_slug})).one_or_none()  # fmt: skip
    if row is None:
        raise SystemExit(f"{admin_email} is not an active member of '{tenant_slug}'")
    tenant_id: uuid.UUID = row.tenant_id
    async with tenant_session(tenant_id) as s:
        return await remask(s)


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--admin", required=True, help="an active member's email, to find the company")
    p.add_argument("--tenant", required=True, help="company slug")
    a = p.parse_args()
    print(asyncio.run(run(a.admin, a.tenant)))
