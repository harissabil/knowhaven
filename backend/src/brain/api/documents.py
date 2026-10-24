"""Document repository: browse upload folders, update or delete uploaded documents.

Who sees what (the same rules as everywhere else, design doc 4.3 / 8):
  list      admins see every uploaded document's metadata (they manage folders); everyone else
            only documents in folders their roles can see.
  content   only through /api/sources, i.e. the normal visibility check. The admin role alone
            grants no content.
  manage    upload a new version or delete: admins, or HR / managers in a folder they can see
            (the same people who may upload there).
  original  the stored file only if the item is visible AND the user may see every kind of
            personal data it contains (the original is unmasked); otherwise the masked text only.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select

from brain import storage
from brain.api.deps import Member
from brain.api.uploads import (
    UPLOAD_SOURCES,
    document_item,
    get_ingestor,
    may_upload,
    read_upload,
    store_original,
    user_email,
    writable_container,
)
from brain.audit import log as audit
from brain.db.models import (
    Chunk,
    Container,
    ContainerAcl,
    IngestionEvent,
    PiiPermission,
    Role,
    SourceItem,
)
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem
from brain.rbac.visibility import visible_container_clause, visible_item_clause

router = APIRouter(prefix="/documents", tags=["documents"])


class FolderOut(BaseModel):
    id: str
    name: str
    source: str  # upload_folder | whatsapp_group
    tier: str
    mapped: bool
    role_names: list[str]  # who can read it; empty = nobody yet
    document_count: int
    visible_to_me: bool
    can_upload: bool


class DocumentOut(BaseModel):
    id: str
    title: str | None
    filename: str
    folder_id: str
    folder_name: str
    type: str
    authority: str
    created_at: datetime
    updated_at: datetime
    revisions: int
    uploaded_by: str | None
    chunk_count: int
    injection_flag: bool
    has_pii: bool
    can_read: bool  # content visible through /api/sources
    can_manage: bool  # new version / delete
    can_download: bool  # original file


async def _folder_rows(s, ctx):
    q = select(Container).where(Container.source.in_(UPLOAD_SOURCES))
    if not ctx.is_admin:
        q = q.where(visible_container_clause(ctx))
    return (await s.scalars(q.order_by(Container.name))).all()


async def _visible_container_ids(s, ctx) -> set[uuid.UUID]:
    return set(await s.scalars(select(Container.id).where(visible_container_clause(ctx))))


@router.get("/folders")
async def folders(ctx: Member) -> list[FolderOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await _folder_rows(s, ctx)
        ids = [c.id for c in rows]
        acl: dict[uuid.UUID, list[str]] = {}
        for cid, name in await s.execute(
            select(ContainerAcl.container_id, Role.name)
            .join(Role, Role.id == ContainerAcl.role_id)
            .where(ContainerAcl.container_id.in_(ids))
            .order_by(Role.name)
        ):
            acl.setdefault(cid, []).append(name)
        counts = dict(
            (
                await s.execute(
                    select(SourceItem.container_id, func.count())
                    .where(
                        SourceItem.container_id.in_(ids),
                        SourceItem.deleted_at.is_(None),
                        SourceItem.source == "upload",
                    )  # fmt: skip
                    .group_by(SourceItem.container_id)
                )
            ).all()
        )
        visible = await _visible_container_ids(s, ctx)
        uploader = await may_upload(s, ctx)
    return [
        FolderOut(id=str(c.id), name=c.name, source=c.source, tier=c.tier, mapped=c.mapped,
                  role_names=acl.get(c.id, []) if c.mapped else [], document_count=counts.get(c.id, 0),
                  visible_to_me=c.id in visible, can_upload=uploader and (ctx.is_admin or c.id in visible))
        for c in rows
    ]  # fmt: skip


async def _pii_types(s, ctx) -> set[str]:
    if not ctx.business_role_ids:
        return set()
    return set(await s.scalars(select(PiiPermission.pii_type).where(PiiPermission.role_id.in_(sorted(ctx.business_role_ids)))))  # fmt: skip


async def _documents(s, ctx, item_id: str | None = None, folder_id: uuid.UUID | None = None,
                     q: str | None = None) -> list[DocumentOut]:  # fmt: skip
    stmt = (
        select(SourceItem, Container.name)
        .join(Container, (Container.id == SourceItem.container_id) & (Container.tenant_id == SourceItem.tenant_id))
        .where(SourceItem.source == "upload", SourceItem.deleted_at.is_(None))
    )  # fmt: skip
    if not ctx.is_admin:
        stmt = stmt.where(visible_item_clause(ctx))
    if item_id:
        stmt = stmt.where(SourceItem.id == item_id)
    if folder_id:
        stmt = stmt.where(SourceItem.container_id == folder_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(SourceItem.title.ilike(like) | SourceItem.external_ref.ilike(like))
    rows = (await s.execute(stmt.order_by(SourceItem.updated_at.desc()).limit(500))).all()
    if not rows:
        return []
    ids = [it.id for it, _ in rows]
    readable = set(
        await s.scalars(
            select(SourceItem.id).where(SourceItem.id.in_(ids), visible_item_clause(ctx))
        )
    )
    chunks = dict(
        (
            await s.execute(
                select(Chunk.item_id, func.count())
                .where(Chunk.item_id.in_(ids))
                .group_by(Chunk.item_id)
            )
        ).all()
    )
    revs = dict((await s.execute(
        select(IngestionEvent.external_ref, func.count())
        .where(IngestionEvent.source == "upload", IngestionEvent.event_type.in_(("create", "update")),
               IngestionEvent.external_ref.in_([it.external_ref for it, _ in rows]))
        .group_by(IngestionEvent.external_ref))).all())  # fmt: skip
    visible_folders = await _visible_container_ids(s, ctx)
    uploader = await may_upload(s, ctx)
    allowed_pii = await _pii_types(s, ctx)
    out = []
    for it, folder_name in rows:
        pii = {sp.get("type") for sp in (it.pii_spans or [])}
        can_read = it.id in readable
        out.append(DocumentOut(
            id=it.id, title=it.title, filename=it.external_ref.rsplit("/", 1)[-1], folder_id=str(it.container_id),
            folder_name=folder_name, type=it.type, authority=it.authority, created_at=it.created_at,
            updated_at=it.updated_at, revisions=max(1, revs.get(it.external_ref, 1)), uploaded_by=it.author_display,
            chunk_count=chunks.get(it.id, 0), injection_flag=it.injection_flag, has_pii=bool(pii), can_read=can_read,
            can_manage=uploader and (ctx.is_admin or it.container_id in visible_folders),
            can_download=bool(it.storage_key) and can_read and pii <= allowed_pii,
        ))  # fmt: skip
    return out


@router.get("")
async def list_documents(
    ctx: Member, folder_id: uuid.UUID | None = None, q: str | None = None
) -> list[DocumentOut]:
    async with tenant_session(ctx.tenant_id) as s:
        return await _documents(s, ctx, folder_id=folder_id, q=q)


async def _one(ctx, item_id: str) -> tuple[DocumentOut, SourceItem]:
    async with tenant_session(ctx.tenant_id) as s:
        docs = await _documents(s, ctx, item_id=item_id)
        row = await s.scalar(select(SourceItem).where(SourceItem.id == item_id)) if docs else None
    if not docs or row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document_not_found")
    return docs[0], row


@router.get("/{item_id}")
async def get_document(item_id: str, ctx: Member) -> DocumentOut:
    return (await _one(ctx, item_id))[0]


@router.get("/{item_id}/original")
async def original(item_id: str, ctx: Member) -> dict:
    """Short-lived link to the stored file, under the `original` rule above."""
    doc, row = await _one(ctx, item_id)
    if not doc.can_download:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "original_not_allowed")
    return {
        "url": storage.presigned_get_url(row.storage_key, expires_in=300),
        "filename": doc.filename,
    }


def _manageable(doc: DocumentOut) -> None:
    if not doc.can_manage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "document_manage_not_allowed")


@router.put("/{item_id}/file")
async def replace_file(
    item_id: str,
    ctx: Member,
    ingestor: Annotated[Ingestor, Depends(get_ingestor)],
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
) -> DocumentOut:
    """Upload a new version: same document ID and citations, new text and file."""
    doc, row = await _one(ctx, item_id)
    _manageable(doc)
    container = await writable_container(ctx, row.container_id)
    filename, data = await read_upload(file)
    item = document_item(
        container,
        filename,
        data,
        title or row.title,
        row.external_ref,
        await user_email(ctx.user_id),
    )
    key = await store_original(ctx, container, filename, data)
    item.storage_key = key
    report = await ingestor.ingest(ctx.tenant_id, [item])
    if row.storage_key and row.storage_key != key:
        await storage.delete_object(row.storage_key)
    async with tenant_session(ctx.tenant_id) as s:
        await audit.append(s, ctx.tenant_id, "upload", actor_user_id=ctx.user_id, channel="web",
                           permission_version=ctx.permission_version, roles_snapshot=sorted(ctx.role_keys),
                           retrieved_item_ids=report.item_ids,
                           details=audit.jsonable({"action": "new_version", "item_id": item_id, "filename": filename,
                                                   "storage_key": key, "updated": report.updated}))  # fmt: skip
    return (await _one(ctx, item_id))[0]


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    item_id: str, ctx: Member, ingestor: Annotated[Ingestor, Depends(get_ingestor)]
) -> None:
    """Remove from search and answers (soft delete, kept for the audit trail) and drop the file."""
    doc, row = await _one(ctx, item_id)
    _manageable(doc)
    tombstone = IngestItem(
        source="upload", container_external_id="", container_name="", external_ref=row.external_ref,
        type=row.type, text="", created_at=row.created_at, updated_at=row.updated_at, deleted=True,
    )  # fmt: skip
    async with tenant_session(ctx.tenant_id) as s:
        c = await s.scalar(select(Container).where(Container.id == row.container_id))
    tombstone.container_external_id, tombstone.container_name = c.external_id, c.name
    await ingestor.ingest(ctx.tenant_id, [tombstone])
    if row.storage_key:
        await storage.delete_object(row.storage_key)
    async with tenant_session(ctx.tenant_id) as s:
        await audit.append(s, ctx.tenant_id, "upload", actor_user_id=ctx.user_id, channel="web",
                           permission_version=ctx.permission_version, roles_snapshot=sorted(ctx.role_keys),
                           retrieved_item_ids=[item_id],
                           details=audit.jsonable({"action": "delete", "item_id": item_id, "filename": doc.filename}))  # fmt: skip
