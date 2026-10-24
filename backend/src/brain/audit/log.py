"""Append-only, hash-chained audit log per tenant (design doc 7.3, 19 "Keeps a record").

row_hash = sha256(prev_hash + canonical_json(row)). Rows are serialized per tenant with a
transaction-scoped advisory lock, so `seq` has no gaps and the chain has no forks.
brain_app can't UPDATE/DELETE audit_log (migration c4fdb4b4ac66), and `verify_chain` detects
any change made with higher privileges.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import AuditLog, PermissionState
from brain.rbac.context import RequestContext

GENESIS = "0" * 64
# Columns covered by the hash, in a fixed order. Everything an auditor relies on is here.
HASHED_FIELDS = (
    "tenant_id", "seq", "query_id", "ts", "event_type", "actor_user_id", "channel",
    "query_text", "language", "intent", "permission_version", "roles_snapshot",
    "retrieved_item_ids", "filtered_count", "decision_path", "response_text", "citations",
    "model_ids", "prompt_version", "latency_ms", "details",
)  # fmt: skip


def _canonical(row: dict) -> str:
    def norm(v):
        if isinstance(v, datetime):
            return v.astimezone(UTC).isoformat()
        if isinstance(v, UUID):
            return str(v)
        return v

    return json.dumps(
        {k: norm(row.get(k)) for k in HASHED_FIELDS},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )


def _hash(prev_hash: str, row: dict) -> str:
    return hashlib.sha256((prev_hash + _canonical(row)).encode()).hexdigest()


async def append(s: AsyncSession, tenant_id: UUID, event_type: str, **fields) -> AuditLog:
    """Append one row in the caller's transaction (it commits or rolls back with the change)."""
    await s.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": f"audit:{tenant_id}"}
    )
    last = (
        await s.execute(
            select(AuditLog.seq, AuditLog.row_hash).order_by(AuditLog.seq.desc()).limit(1)
        )
    ).one_or_none()
    seq, prev_hash = (last.seq + 1, last.row_hash) if last else (1, GENESIS)
    row = {
        "roles_snapshot": [],
        "retrieved_item_ids": [],
        "citations": [],
        **fields,
        "tenant_id": tenant_id,
        "seq": seq,
        "ts": datetime.now(UTC),
        "event_type": event_type,
    }
    entry = AuditLog(**row, prev_hash=prev_hash, row_hash=_hash(prev_hash, row))
    s.add(entry)
    await s.flush()
    return entry


@dataclass(frozen=True)
class ChainCheck:
    ok: bool
    rows: int
    first_bad_seq: int | None = None


async def verify_chain(s: AsyncSession) -> ChainCheck:
    """Recompute every hash for the session's tenant, in order."""
    prev, n = GENESIS, 0
    rows = await s.stream_scalars(select(AuditLog).order_by(AuditLog.seq))
    async for r in rows:
        n += 1
        data = {k: getattr(r, k) for k in HASHED_FIELDS}
        if r.seq != n or r.prev_hash != prev or r.row_hash != _hash(prev, data):
            return ChainCheck(False, n, r.seq)
        prev = r.row_hash
    return ChainCheck(True, n)


async def count(s: AsyncSession) -> int:
    return await s.scalar(select(func.count()).select_from(AuditLog))


def jsonable(v):
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, list | tuple | set | frozenset):
        return [jsonable(x) for x in v]
    if isinstance(v, UUID | datetime):
        return str(v)
    return v


async def admin_event(
    s: AsyncSession,
    ctx: RequestContext,
    action: str,
    permission_version: int | None = None,
    **details,
) -> AuditLog:
    """An admin configuration change, attributed to the acting admin and their roles."""
    if permission_version is None:
        permission_version = await s.scalar(select(PermissionState.version))
    return await append(
        s,
        ctx.tenant_id,
        "admin",
        actor_user_id=ctx.user_id,
        channel="web",
        permission_version=permission_version,
        roles_snapshot=sorted(ctx.role_keys),
        details={"action": action, **jsonable(details)},
    )


async def membership_event(
    s: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    action: str,
    *,
    channel: str = "web",
    **details,
) -> AuditLog:
    """A user acting on their own membership (create company, accept invite, join, leave)."""
    return await append(
        s,
        tenant_id,
        "membership",
        actor_user_id=user_id,
        channel=channel,
        permission_version=await s.scalar(select(PermissionState.version)),
        details={"action": action, **jsonable(details)},
    )
