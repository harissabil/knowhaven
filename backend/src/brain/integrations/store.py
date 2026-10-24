"""Integration rows: encrypted credentials + non-secret metadata, and the cross-tenant lookups.

Credentials (`config_encrypted`) are only ever decrypted here and never returned by an API.
"""

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Integration
from brain.db.session import global_session, tenant_session
from brain.security import decrypt, encrypt


class WorkspaceTaken(Exception):
    """This Slack workspace / Atlassian site is already connected to another company."""


@dataclass
class Active:
    integration_id: uuid.UUID
    tenant_id: uuid.UUID
    type: str


def config(row: Integration) -> dict:
    return json.loads(decrypt(row.config_encrypted))


def token_hint(secret: str) -> str:
    return "••••" + secret[-4:] if len(secret) > 8 else "••••"


async def upsert(
    tenant_id: uuid.UUID,
    type_: str,
    external_id: str,
    cfg: dict,
    user_id: uuid.UUID | None,
    meta: dict,
) -> Integration:
    """Create or refresh this tenant's integration. The (type, workspace) pair is unique across
    tenants, so one workspace can never feed two companies (T31)."""
    owner = await resolve_tenant(type_, external_id)
    if owner is not None and owner != tenant_id:
        raise WorkspaceTaken(external_id)
    try:
        async with tenant_session(tenant_id) as s:
            row = await s.scalar(
                select(Integration).where(
                    Integration.type == type_, Integration.external_workspace_id == external_id
                )
            )
            if row is None:
                row = Integration(tenant_id=tenant_id, type=type_, external_workspace_id=external_id,
                                  config_encrypted=b"", connected_by=user_id)  # fmt: skip
                s.add(row)
            row.config_encrypted = encrypt(json.dumps(cfg))
            row.status = "active"
            row.last_error = None
            row.meta = {**(row.meta or {}), **meta}
            row.connected_by = user_id or row.connected_by
            await s.flush()
            return row
    except IntegrityError:
        raise WorkspaceTaken(external_id) from None


async def resolve_tenant(type_: str, external_id: str) -> uuid.UUID | None:
    """Which tenant owns this (connected) workspace? Runs before any tenant is known (SECURITY
    DEFINER). A disconnected row owned by another tenant is still protected: inserting the same
    (type, workspace) hits the unique constraint, which `upsert` reports as WorkspaceTaken."""
    async with global_session() as s:
        return await s.scalar(
            text("SELECT resolve_integration(:t, :e)"), {"t": type_, "e": external_id}
        )


async def list_active(types: list[str]) -> list[Active]:
    async with global_session() as s:
        rows = (
            await s.execute(text("SELECT * FROM list_active_integrations(:t)"), {"t": types})
        ).all()
    return [Active(r.integration_id, r.tenant_id, r.type) for r in rows]


async def get(s: AsyncSession, type_: str) -> Integration | None:
    """The tenant's (non-disconnected) integration of a type; `s` is tenant-scoped."""
    return await s.scalar(
        select(Integration).where(Integration.type == type_, Integration.status != "disconnected")
    )


async def mark(tenant_id: uuid.UUID, integration_id: uuid.UUID, *, error: str | None = None,
               synced: bool = False, meta: dict | None = None) -> None:  # fmt: skip
    values: dict = {"last_error": error, "status": "error" if error else "active"}
    if synced:
        values["last_sync_at"] = datetime.now(UTC)
    async with tenant_session(tenant_id) as s:
        if meta:
            row = await s.scalar(select(Integration).where(Integration.id == integration_id))
            values["meta"] = {**(row.meta or {}), **meta}
        await s.execute(
            update(Integration).where(Integration.id == integration_id).values(**values)
        )
