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
from brain.db.models import Container, Manager
from brain.db.session import tenant_session
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


def _ext(filename: str) -> str:
    m = re.search(r"\.[A-Za-z0-9]+$", filename)
    return m.group(0).lower() if m else ""


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
async def upload(
    ctx: Member,
    ingestor: Annotated[Ingestor, Depends(get_ingestor)],
    container_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
) -> UploadOut:
    async with tenant_session(ctx.tenant_id) as s:
        is_manager = await s.scalar(select(exists().where(Manager.manager_user_id == ctx.user_id)))
        if not (ctx.is_admin or "hr" in ctx.role_keys or is_manager):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "upload_not_allowed")
        q = select(Container).where(Container.id == container_id)
        if not ctx.is_admin:
            q = q.where(visible_container_clause(ctx))  # you can only add to what you can see
        container = await s.scalar(q)
    if container is None or container.source not in ("upload_folder", "whatsapp_group"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "container_not_found")

    filename = (file.filename or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    ext = _ext(filename)
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "file_too_large")

    if container.source == "whatsapp_group":
        if ext != ".txt":
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "whatsapp_export_must_be_txt"
            )
        items = whatsapp.to_items(
            data.decode("utf-8", errors="replace"), container.external_id, container.name
        )
    else:
        if ext not in DOC_TYPES:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type")
        try:
            parsed_title, sections = parse_document(filename, data)
        except Exception as e:  # noqa: BLE001 - corrupt file
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unreadable_file") from e
        doc_title = title or parsed_title or filename.rsplit(".", 1)[0]
        now = datetime.now(UTC)
        items = [
            IngestItem(
                source="upload",
                container_external_id=container.external_id,
                container_name=container.name,
                external_ref=f"{container.external_id}/{filename}",
                type="doc",
                text="",
                sections=sections,
                title=doc_title,
                id_hint=slugify(doc_title),
                created_at=now,
                updated_at=now,
                version=int(time.time()),  # re-uploading the same file name = a new version
                author_external_id=None,
            )
        ]

    key = storage.tenant_key(
        ctx.tenant_id, "uploads", str(container.id), f"{uuid.uuid4().hex}-{filename}"
    )
    await storage.put_object(key, data, CONTENT_TYPES.get(ext, "application/octet-stream"))
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
