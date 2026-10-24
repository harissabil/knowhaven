"""Execution of APPROVED drafts (design doc 12.2). This is the only code that changes documents.

Targets:
  confluence  real page update via the tenant's Atlassian credentials: only for pages that came
              from the connected site. The page must still be at the version the draft was based
              on (otherwise someone edited it: re-draft, 15.2); the approved text replaces the old
              text in the page XHTML and is saved as version+1, then re-ingested from Confluence.
              Without a connected site (or for imported pages) it falls back to `internal`.
  internal    a new version of our copy of the document, through the normal ingestion pipeline
              (fallback 24.1 #2), so answers immediately use the updated text.
"""

import html
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import ActionDraft, Chunk, Container, Integration, SourceItem
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem, Section
from brain.integrations import store
from brain.integrations.atlassian import AtlassianClient, AtlassianError, Space, page_to_item


class ExecutionError(Exception):
    pass


async def _confluence_cfg(s: AsyncSession) -> dict | None:
    row = await s.scalar(
        select(Integration).where(Integration.type == "confluence", Integration.status == "active")
    )
    return store.config(row) if row else None


async def _write_confluence(
    cfg: dict, item: SourceItem, container: Container, p: dict, draft: ActionDraft
) -> IngestItem:
    """PUT the approved change to the live page and return the page as re-read from Confluence."""
    try:
        async with AtlassianClient(cfg["site"], cfg["email"], cfg["token"]) as c:
            page = await c.page(item.external_ref)
            current = int((page.get("version") or {}).get("number") or 0)
            if current != item.version:
                raise ExecutionError(
                    "target_changed_since_draft"
                )  # edited in Confluence since sync
            storage = ((page.get("body") or {}).get("storage") or {}).get("value", "")
            old, new = p["old_text"], p["new_text"]
            for needle, repl in (
                (html.escape(old, quote=False), html.escape(new, quote=False)),
                (old, new),
            ):
                if needle in storage:
                    storage = storage.replace(needle, repl, 1)
                    break
            else:
                raise ExecutionError("text_not_found_in_page")
            await c.update_page(item.external_ref, page.get("title") or item.title or "", storage, current + 1,
                                f"Disetujui lewat Knowhaven (draf {str(draft.id)[:8]})")  # fmt: skip
            fresh = await c.page(item.external_ref)
    except AtlassianError as e:
        raise ExecutionError(f"confluence_{e.reason}") from e
    return page_to_item(fresh, Space("", container.external_id, container.name), cfg["site"])


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
        cfg = await _confluence_cfg(s) if draft.target_system == "confluence" else None

    now = datetime.now(UTC)
    live = bool(cfg) and item.source == "confluence" and (item.url or "").startswith(cfg["site"])
    if live:
        mode, note = "confluence", None
        updated = await _write_confluence(cfg, item, container, p, draft)
    else:
        mode = "internal"
        note = None
        if draft.target_system == "confluence":
            note = (
                "page_not_on_connected_site" if cfg else "confluence_not_connected"
            ) + ": applied to the internal copy (fallback 24.1 #2)"
        updated = IngestItem(
            source=item.source, container_external_id=container.external_id, container_name=container.name,
            external_ref=item.external_ref, type="doc", text="", sections=sections, title=item.title,
            id_hint=item.id.removeprefix("DOC-"), created_at=item.created_at, updated_at=now,
            version=item.version + 1, url=item.url, storage_key=item.storage_key,
        )  # fmt: skip
    report = await (ingestor or Ingestor()).ingest(tenant_id, [updated])
    if report.updated != 1:
        raise ExecutionError("ingest_failed")
    return {
        "mode": mode,
        "note": note,
        "item_id": item.id,
        "new_version": updated.version,
        "url": item.url if live else None,
        "executed_at": now.isoformat(),
    }
