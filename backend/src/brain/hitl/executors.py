"""Execution of APPROVED drafts (design doc 12.2). This is the only code that changes documents.

Targets:
  confluence  real page update via the tenant's Atlassian credentials (Phase 11). Until a
              Confluence integration is connected, falls back to `internal` and says so.
  internal    a new version of our copy of the document, through the normal ingestion pipeline
              (fallback 24.1 #2), so answers immediately use the updated text.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import ActionDraft, Chunk, Container, Integration, SourceItem
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem, Section


class ExecutionError(Exception):
    pass


async def _confluence_available(s: AsyncSession) -> bool:
    return bool(
        await s.scalar(
            select(Integration.id).where(
                Integration.type == "confluence", Integration.status == "active"
            )
        )
    )


async def _sections_with_change(
    s: AsyncSession, item_id: str, anchor: str | None, old_text: str, new_text: str
) -> list[Section]:
    chunks = (
        await s.scalars(select(Chunk).where(Chunk.item_id == item_id).order_by(Chunk.ord))
    ).all()
    sections, replaced = [], False
    for c in chunks:
        heading = (
            c.context_text.split(" › ", 1)[1]
            if c.context_text and " › " in c.context_text
            else None
        )
        text = c.text_raw
        if not replaced and (anchor is None or c.anchor == anchor) and c.text_raw == old_text:
            text, replaced = new_text, True
        sections.append(Section(c.anchor, heading, text))
    if not replaced:
        raise ExecutionError("target_changed_since_draft")  # someone edited it: re-draft (15.2)
    return sections


async def execute(draft: ActionDraft, tenant_id, ingestor: Ingestor | None = None) -> dict:
    p = draft.payload
    async with tenant_session(tenant_id) as s:
        item = await s.scalar(select(SourceItem).where(SourceItem.id == p["item_id"]))
        if item is None or item.deleted_at is not None:
            raise ExecutionError("target_missing")
        if item.version != p["base_version"]:
            raise ExecutionError("target_changed_since_draft")
        container = await s.scalar(select(Container).where(Container.id == item.container_id))
        sections = await _sections_with_change(
            s, item.id, p.get("anchor"), p["old_text"], p["new_text"]
        )
        confluence = draft.target_system == "confluence" and await _confluence_available(s)

    mode = "internal"
    note = None
    if draft.target_system == "confluence" and not confluence:
        note = "confluence_not_connected: applied to the internal copy (fallback 24.1 #2)"
    # (Phase 11: when connected, PUT the page with version+1 here, then re-ingest from Confluence.)
    now = datetime.now(UTC)
    report = await (ingestor or Ingestor()).ingest(
        tenant_id,
        [
            IngestItem(
                source=item.source, container_external_id=container.external_id, container_name=container.name,
                external_ref=item.external_ref, type="doc", text="", sections=sections, title=item.title,
                id_hint=item.id.removeprefix("DOC-"), created_at=item.created_at, updated_at=now,
                version=item.version + 1, url=item.url, storage_key=item.storage_key,
            )
        ],
    )  # fmt: skip
    if report.updated != 1:
        raise ExecutionError("ingest_failed")
    return {
        "mode": mode,
        "note": note,
        "item_id": item.id,
        "new_version": item.version + 1,
        "executed_at": now.isoformat(),
    }
