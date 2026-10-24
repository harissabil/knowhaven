"""Pull Confluence + Jira into the knowledge base (the worker calls this every ~2 minutes).

Rules
- Every page/issue goes through the normal ingestion pipeline; unchanged ones are skipped there.
- New spaces/projects/channels become containers with tier=hidden, mapped=false (default-deny,
  T25): nobody sees them until an admin maps them.
- Adoption: the demo data was imported from files before the live site existed. A live space or
  project with the same key, or a Slack channel with the same name, takes over that container
  (and its role mapping); a live page/issue with the same title takes over the imported item, so
  citation IDs such as DOC-sop-reimbursement#3 stay valid.
- Deletion: an item that came from this live site (its URL starts with the site) and is no longer
  returned is soft-deleted, so it stops being cited. Imported items that were never adopted are
  left alone.
"""

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update

from brain.db.models import Container, SourceItem
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import CONTAINER_KIND, IngestItem
from brain.integrations import store
from brain.integrations.atlassian import AtlassianClient, AtlassianError, issue_item, page_to_item

log = logging.getLogger(__name__)


async def ensure_containers(tenant_id: uuid.UUID, kind: str, found: list[tuple[str, str]],
                            adopt_by_name: bool = False) -> dict:  # fmt: skip
    """Make sure every remote space/project/channel has a container. Returns counts."""
    created = adopted = 0
    async with tenant_session(tenant_id) as s:
        rows = (await s.scalars(select(Container).where(Container.source == kind))).all()
        by_ext = {c.external_id: c for c in rows}
        live_ids = {ext for ext, _ in found}
        for ext, name in found:
            if ext in by_ext:
                if by_ext[ext].name != name:
                    by_ext[ext].name = name
                continue
            twin = next(
                (
                    c
                    for c in rows
                    if adopt_by_name and c.name == name and c.external_id not in live_ids
                ),
                None,
            )
            if twin is not None:
                twin.external_id = ext  # keeps its ACL / tier / owner
                adopted += 1
                continue
            s.add(Container(id=uuid.uuid4(), tenant_id=tenant_id, source=kind, external_id=ext, name=name,
                            tier="hidden", mapped=False))  # fmt: skip
            created += 1
    return {"created": created, "adopted": adopted}


def _bare_title(item: IngestItem) -> str:
    t = item.title or ""
    if item.source == "jira" and item.structured:  # "OPS-3: Kapal telat" → "Kapal telat"
        return (item.structured.get("summary") or "").strip().lower()
    return t.strip().lower()


async def _adopt_items(tenant_id: uuid.UUID, items: list[IngestItem], site: str) -> int:
    """Point imported items at their live twins (same container + same title)."""
    if not items:
        return 0
    source = items[0].source
    kind = CONTAINER_KIND[source]
    adopted = 0
    async with tenant_session(tenant_id) as s:
        containers = {
            c.external_id: c.id
            for c in await s.scalars(select(Container).where(Container.source == kind))
        }
        existing = (
            await s.scalars(
                select(SourceItem).where(
                    SourceItem.source == source, SourceItem.deleted_at.is_(None)
                )
            )
        ).all()
        by_ref = {e.external_ref: e for e in existing}
        live_refs = {it.external_ref for it in items}
        for it in items:
            ex = by_ref.get(it.external_ref)
            if ex is not None:
                same = (
                    (ex.structured or {}).get("summary", ex.title or "").strip().lower()
                    if source == "jira"
                    else (ex.title or "").strip().lower()
                )
                if ex.url and ex.url.startswith(site) or same == _bare_title(it):
                    continue  # already ours
                # An imported item happens to use this live key (e.g. OPS-3): move it aside first.
                await s.execute(
                    update(SourceItem)
                    .where(SourceItem.id == ex.id)
                    .values(external_ref=f"import:{ex.external_ref}")
                )
                by_ref.pop(it.external_ref)
                by_ref[f"import:{ex.external_ref}"] = ex
                ex.external_ref = f"import:{ex.external_ref}"
            cid = containers.get(it.container_external_id)
            twin = next((e for e in existing
                         if e.container_id == cid and e.external_ref not in live_refs and not (e.url or "").startswith(site)
                         and ((e.structured or {}).get("summary", "") if source == "jira" else (e.title or "")).strip().lower() == _bare_title(it)),
                        None)  # fmt: skip
            if twin is not None:
                await s.execute(
                    update(SourceItem)
                    .where(SourceItem.id == twin.id)
                    .values(external_ref=it.external_ref)
                )
                twin.external_ref = it.external_ref
                by_ref[it.external_ref] = twin
                adopted += 1
    return adopted


async def _tombstones(tenant_id: uuid.UUID, source: str, container_ext_ids: set[str], live_refs: set[str],
                      site: str) -> list[IngestItem]:  # fmt: skip
    kind = CONTAINER_KIND[source]
    async with tenant_session(tenant_id) as s:
        rows = (await s.execute(
            select(SourceItem, Container.external_id, Container.name)
            .join(Container, (Container.id == SourceItem.container_id) & (Container.tenant_id == SourceItem.tenant_id))
            .where(SourceItem.source == source, SourceItem.deleted_at.is_(None), Container.source == kind,
                   Container.external_id.in_(sorted(container_ext_ids)))
        )).all()  # fmt: skip
    now = datetime.now(UTC)
    return [
        IngestItem(source=source, container_external_id=ext, container_name=name, external_ref=it.external_ref,
                   type=it.type, text="", created_at=it.created_at, updated_at=now, deleted=True)
        for it, ext, name in rows
        if it.external_ref not in live_refs and (it.url or "").startswith(site)
    ]  # fmt: skip


async def sync_atlassian(
    tenant_id: uuid.UUID, ingestor: Ingestor | None = None, transport=None
) -> dict:
    """One pass over the tenant's Confluence + Jira. Errors are recorded on the integration."""
    async with tenant_session(tenant_id) as s:
        conf, jira = await store.get(s, "confluence"), await store.get(s, "jira")
        rows = [r for r in (conf, jira) if r is not None]
        cfgs = {r.type: (r.id, store.config(r)) for r in rows}
    if not cfgs:
        return {"skipped": "not_connected"}
    ingestor = ingestor or Ingestor()
    report: dict = {}
    for type_, (iid, cfg) in cfgs.items():
        site = cfg["site"]
        try:
            async with AtlassianClient(site, cfg["email"], cfg["token"], transport=transport) as c:
                if type_ == "confluence":
                    spaces = await c.spaces()
                    await ensure_containers(
                        tenant_id, "confluence_space", [(sp.key, sp.name) for sp in spaces]
                    )
                    items = [page_to_item(p, sp, site) for sp in spaces for p in await c.pages(sp)]
                    scope = {sp.key for sp in spaces}
                    meta = {"spaces": len(spaces), "pages": len(items)}
                else:
                    projects = await c.projects()
                    await ensure_containers(
                        tenant_id, "jira_project", [(p.key, p.name) for p in projects]
                    )
                    keys = ",".join(f'"{p.key}"' for p in projects)
                    issues = (
                        await c.search(f"project in ({keys}) ORDER BY updated DESC")
                        if projects
                        else []
                    )
                    items = [issue_item(i, site) for i in issues]
                    scope = {p.key for p in projects}
                    meta = {"projects": len(projects), "issues": len(items)}
            adopted = await _adopt_items(tenant_id, items, site)
            gone = await _tombstones(
                tenant_id, type_, scope, {it.external_ref for it in items}, site
            )
            r = await ingestor.ingest(tenant_id, items + gone)
            meta |= {
                "last_created": r.created,
                "last_updated": r.updated,
                "last_deleted": r.deleted,
                "adopted_total": adopted,
            }
            await store.mark(tenant_id, iid, synced=True, meta=meta)
            report[type_] = meta
        except AtlassianError as e:
            await store.mark(tenant_id, iid, error=f"{e.reason}: {e.detail}"[:300])
            report[type_] = {"error": e.reason}
        except Exception as e:  # noqa: BLE001 - one broken site must not stop the worker
            log.exception("atlassian sync failed for tenant %s", tenant_id)
            await store.mark(tenant_id, iid, error=f"{type(e).__name__}: {e}"[:300])
            report[type_] = {"error": type(e).__name__}
    return report
