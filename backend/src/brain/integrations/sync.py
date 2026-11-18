"""Pull Confluence + Jira into the knowledge base (the worker calls this every ~2 minutes).

Passes
- Incremental (most passes): only pages/issues saved since the previous pass, with a small
  overlap. Nothing changed means two small API calls and no ingestion.
- Full (the first pass, every RECONCILE, and the admin's "Sync now"): every page/issue, which is
  also the only way to notice deletions, since deleted items never show up as "changed".

Rules
- Every page/issue goes through the normal ingestion pipeline; unchanged ones are skipped there.
- New spaces/projects/channels become containers with tier=hidden, mapped=false (default-deny,
  T25): nobody sees them until an admin maps them.
- Adoption: the demo data was imported from files before the live site existed. A live space or
  project with the same key, or a Slack channel with the same name, takes over that container
  (and its role mapping); a live page/issue with the same title takes over the imported item, so
  citation IDs such as DOC-sop-reimbursement#3 stay valid.
- Source of truth: once a site is connected, it IS the company's Confluence/Jira. Every page or
  issue of that source that the site no longer returns is soft-deleted, so it stops being cited:
  pages deleted in Confluence, and imported copies that no live page took over (so two diverging
  versions of e.g. a salary table never compete as a false conflict).
"""

import logging
import math
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import load_only

from brain.db.models import Container, SourceItem
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import CONTAINER_KIND, IngestItem
from brain.integrations import store
from brain.integrations.atlassian import AtlassianClient, AtlassianError, issue_item, page_to_item

# The worker runs these on every pass, so leave out the item bodies (raw_text, pii_spans): they are
# most of each row and only cost network transfer from the database.
_LIGHT = load_only(
    SourceItem.id, SourceItem.type, SourceItem.container_id, SourceItem.external_ref,
    SourceItem.url, SourceItem.title, SourceItem.structured, SourceItem.created_at,
)  # fmt: skip

log = logging.getLogger(__name__)

RECONCILE = timedelta(minutes=30)
OVERLAP = timedelta(minutes=2)  # clock skew and saves that land while a pass runs


def _since(meta: dict, now: datetime, full: bool | None) -> datetime | None:
    """The incremental window start, or None when this pass must be a full one."""
    if full:
        return None
    try:
        cursor = datetime.fromisoformat(meta["cursor"])
        last_full = datetime.fromisoformat(meta["last_full_at"])
    except (KeyError, TypeError, ValueError):
        return None
    if full is None and now - last_full >= RECONCILE:
        return None
    return cursor - OVERLAP


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
                select(SourceItem)
                .options(_LIGHT)
                .where(SourceItem.source == source, SourceItem.deleted_at.is_(None))
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


async def _tombstones(tenant_id: uuid.UUID, source: str, live_refs: set[str]) -> list[IngestItem]:
    """Everything of this source the live site didn't return (see "Source of truth" above)."""
    kind = CONTAINER_KIND[source]
    async with tenant_session(tenant_id) as s:
        rows = (await s.execute(
            select(SourceItem, Container.external_id, Container.name)
            .options(_LIGHT)
            .join(Container, (Container.id == SourceItem.container_id) & (Container.tenant_id == SourceItem.tenant_id))
            .where(SourceItem.source == source, SourceItem.deleted_at.is_(None), Container.source == kind)
        )).all()  # fmt: skip
    now = datetime.now(UTC)
    return [
        IngestItem(source=source, container_external_id=ext, container_name=name, external_ref=it.external_ref,
                   type=it.type, text="", created_at=it.created_at, updated_at=now, deleted=True)
        for it, ext, name in rows
        if it.external_ref not in live_refs
    ]  # fmt: skip


async def sync_atlassian(
    tenant_id: uuid.UUID, ingestor: Ingestor | None = None, transport=None, full: bool | None = None
) -> dict:
    """One pass over the tenant's Confluence + Jira. Errors are recorded on the integration.

    full=None lets the schedule decide (see the module docstring); True forces a full pass."""
    async with tenant_session(tenant_id) as s:
        conf, jira = await store.get(s, "confluence"), await store.get(s, "jira")
        rows = [r for r in (conf, jira) if r is not None]
        cfgs = {r.type: (r.id, store.config(r), dict(r.meta or {})) for r in rows}
    if not cfgs:
        return {"skipped": "not_connected"}
    ingestor = ingestor or Ingestor()
    report: dict = {}
    for type_, (iid, cfg, prev) in cfgs.items():
        site = cfg["site"]
        now = datetime.now(UTC)
        since = _since(prev, now, full)
        try:
            async with AtlassianClient(site, cfg["email"], cfg["token"], transport=transport) as c:
                if type_ == "confluence":
                    spaces = await c.spaces()
                    await ensure_containers(
                        tenant_id, "confluence_space", [(sp.key, sp.name) for sp in spaces]
                    )
                    if since is None:
                        pages = [(p, sp) for sp in spaces for p in await c.pages(sp)]
                    else:
                        pages = [(p, sp) for sp in spaces for p in await c.pages_changed(sp, since)]
                    items = [page_to_item(p, sp, site) for p, sp in pages]
                    meta = {"spaces": len(spaces)}
                else:
                    projects = await c.projects()
                    await ensure_containers(
                        tenant_id, "jira_project", [(p.key, p.name) for p in projects]
                    )
                    keys = ",".join(f'"{p.key}"' for p in projects)
                    # A relative JQL window, so the Jira user's time zone doesn't matter.
                    window = (
                        f" AND updated >= -{math.ceil((now - since).total_seconds() / 60)}m"
                        if since is not None
                        else ""
                    )
                    issues = (
                        await c.search(f"project in ({keys}){window} ORDER BY updated DESC")
                        if projects
                        else []
                    )
                    items = [issue_item(i, site) for i in issues]
                    meta = {"projects": len(projects)}
            meta |= {"cursor": now.isoformat(), "last_mode": "incremental" if since else "full"}
            if since is None:
                meta |= {"last_full_at": now.isoformat(),
                         "pages" if type_ == "confluence" else "issues": len(items)}  # fmt: skip
            if since is None or items:
                adopted = await _adopt_items(tenant_id, items, site) if items else 0
                gone = (
                    await _tombstones(tenant_id, type_, {it.external_ref for it in items})
                    if since is None
                    else []
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


# --- Webhooks: one item at a time ------------------------------------------------------------------
# A webhook only says which page/issue changed. The item itself is always read back from the site
# with the tenant's own token, so a forged or stale request body can never inject content.


async def _connection(tenant_id: uuid.UUID, type_: str) -> tuple[uuid.UUID, dict] | None:
    async with tenant_session(tenant_id) as s:
        row = await store.get(s, type_)
        return (row.id, store.config(row)) if row is not None else None


async def sync_page(tenant_id: uuid.UUID, page_id: str, ingestor: Ingestor | None = None,
                    transport=None) -> dict:  # fmt: skip
    conn = await _connection(tenant_id, "confluence")
    if conn is None:
        return {"skipped": "not_connected"}
    _, cfg = conn
    async with AtlassianClient(cfg["site"], cfg["email"], cfg["token"], transport=transport) as c:
        try:
            page = await c.page(page_id)
        except AtlassianError as e:
            if e.reason == "not_found":  # deleted, or not readable with our token
                return {"skipped": "not_found"}
            raise
        space = next((sp for sp in await c.spaces() if sp.id == str(page.get("spaceId"))), None)
    if space is None or str(page.get("id")) == space.homepage_id:
        return {"skipped": "not_synced_space"}  # personal space or a space homepage
    await ensure_containers(tenant_id, "confluence_space", [(space.key, space.name)])
    item = page_to_item(page, space, cfg["site"])
    await _adopt_items(tenant_id, [item], cfg["site"])
    r = await (ingestor or Ingestor()).ingest(tenant_id, [item])
    return {"page": page_id, "created": r.created, "updated": r.updated}


async def sync_issue(tenant_id: uuid.UUID, key: str, *, deleted: bool, project: tuple[str, str],
                     ingestor: Ingestor | None = None, transport=None) -> dict:  # fmt: skip
    """project = (key, name), from the webhook; only used to file a deletion."""
    conn = await _connection(tenant_id, "jira")
    if conn is None:
        return {"skipped": "not_connected"}
    _, cfg = conn
    ingestor = ingestor or Ingestor()
    if deleted:
        gone = IngestItem(source="jira", container_external_id=project[0], container_name=project[1],
                          external_ref=key, type="task", text="", created_at=datetime.now(UTC),
                          updated_at=datetime.now(UTC), deleted=True)  # fmt: skip
        r = await ingestor.ingest(tenant_id, [gone])
        return {"issue": key, "deleted": r.deleted}
    async with AtlassianClient(cfg["site"], cfg["email"], cfg["token"], transport=transport) as c:
        issues = await c.search(f'key = "{key}"')
    if not issues:
        return {"skipped": "not_found"}
    item = issue_item(issues[0], cfg["site"])
    await ensure_containers(
        tenant_id, "jira_project", [(item.container_external_id, item.container_name)]
    )
    await _adopt_items(tenant_id, [item], cfg["site"])
    r = await ingestor.ingest(tenant_id, [item])
    return {"issue": key, "created": r.created, "updated": r.updated}
