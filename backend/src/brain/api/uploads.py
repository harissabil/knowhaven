"""Document / WhatsApp-export upload (design doc 4.3, 9.2, 15.4, 15.5)."""

import re
import time
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import exists, select

from brain import storage
from brain.api.deps import Member
from brain.audit import log as audit
from brain.db.models import Container, Manager, User
from brain.db.session import global_session, tenant_session
from brain.ingestion.chunking import slugify
from brain.ingestion.connectors import whatsapp
from brain.ingestion.connectors.documents import parse_document
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem
from brain.rbac.visibility import visible_container_clause

router = APIRouter(tags=["uploads"])

MAX_BYTES = 15 * 1024 * 1024
DOC_TYPES = (".md", ".markdown", ".docx", ".pdf")
CONTENT_TYPES = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def get_ingestor() -> Ingestor:
    return Ingestor()


class UploadOut(BaseModel):
    container_id: str
    storage_key: str
    created: int
    updated: int
    unchanged: int
    item_ids: list[str]
    injection_flagged: list[str]


UPLOAD_SOURCES = ("upload_folder", "whatsapp_group")


def _ext(filename: str) -> str:
    m = re.search(r"\.[A-Za-z0-9]+$", filename)
    return m.group(0).lower() if m else ""


async def may_upload(s, ctx) -> bool:
    """Admins, HR, and anyone who manages something may add files (4.3)."""
    if ctx.is_admin or "hr" in ctx.role_keys:
        return True
    return bool(await s.scalar(select(exists().where(Manager.manager_user_id == ctx.user_id))))


async def writable_container(ctx, container_id: uuid.UUID) -> Container:
    """The upload folder `ctx` may write to: admins any, others only one they can already see.
    Forbidden and unknown are the same 404."""
    async with tenant_session(ctx.tenant_id) as s:
        if not await may_upload(s, ctx):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "upload_not_allowed")
        q = select(Container).where(Container.id == container_id)
        if not ctx.is_admin:
            q = q.where(visible_container_clause(ctx))  # you can only add to what you can see
        container = await s.scalar(q)
    if container is None or container.source not in UPLOAD_SOURCES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "container_not_found")
    return container


async def read_upload(file: UploadFile) -> tuple[str, bytes]:
    filename = (file.filename or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "file_too_large")
    return filename, data


def document_item(container: Container, filename: str, data: bytes, title: str | None,
                  external_ref: str, author_email: str | None) -> IngestItem:  # fmt: skip
    """One document upload as an ingest item. `external_ref` decides identity: the same ref is a
    new version of the same item."""
    if _ext(filename) not in DOC_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type")
    try:
        parsed_title, sections = parse_document(filename, data)
    except Exception as e:  # noqa: BLE001 - corrupt file
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unreadable_file") from e
    doc_title = title or parsed_title or filename.rsplit(".", 1)[0]
    now = datetime.now(UTC)
    return IngestItem(
        source="upload",
        container_external_id=container.external_id,
        container_name=container.name,
        external_ref=external_ref,
        type="doc",
        text="",
        sections=sections,
        title=doc_title,
        id_hint=slugify(doc_title),
        created_at=now,
        updated_at=now,
        version=int(time.time()),
        author_external_id=author_email,  # resolves to the uploader's member record
    )


async def store_original(ctx, container: Container, filename: str, data: bytes) -> str:
    key = storage.tenant_key(
        ctx.tenant_id, "uploads", str(container.id), f"{uuid.uuid4().hex}-{filename}"
    )
    await storage.put_object(
        key, data, CONTENT_TYPES.get(_ext(filename), "application/octet-stream")
    )
    return key


async def user_email(user_id: uuid.UUID) -> str | None:
    async with global_session() as s:
        return await s.scalar(select(User.email).where(User.id == user_id))


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def upload(
    ctx: Member,
    ingestor: Annotated[Ingestor, Depends(get_ingestor)],
    container_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
) -> UploadOut:
    container = await writable_container(ctx, container_id)
    filename, data = await read_upload(file)
    ext = _ext(filename)

    if container.source == "whatsapp_group":
        if ext != ".txt":
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "whatsapp_export_must_be_txt"
            )
        items = whatsapp.to_items(
            data.decode("utf-8", errors="replace"), container.external_id, container.name
        )
    else:
        # Re-uploading the same file name into the same folder = a new version.
        items = [document_item(container, filename, data, title,
                               f"{container.external_id}/{filename}", await user_email(ctx.user_id))]  # fmt: skip

    key = await store_original(ctx, container, filename, data)
    for it in items:
        it.storage_key = key
    report = await ingestor.ingest(ctx.tenant_id, items)

    async with tenant_session(ctx.tenant_id) as s:
        await audit.append(
            s,
            ctx.tenant_id,
            "upload",
            actor_user_id=ctx.user_id,
            channel="web",
            permission_version=ctx.permission_version,
            roles_snapshot=sorted(ctx.role_keys),
            retrieved_item_ids=report.item_ids,
            details=audit.jsonable(
                {
                    "action": "upload",
                    "container_id": container.id,
                    "filename": filename,
                    "storage_key": key,
                    "created": report.created,
                    "updated": report.updated,
                    "injection_flagged": report.injection_flagged,
                }
            ),
        )
    return UploadOut(
        container_id=str(container.id),
        storage_key=key,
        created=report.created,
        updated=report.updated,
        unchanged=report.unchanged,
        item_ids=report.item_ids,
        injection_flagged=report.injection_flagged,
    )
