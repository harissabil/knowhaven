"""Auditor API (design doc 4.4 E, 7.3, 14.2, 19 "Keeps a record").

Auditors see every query and admin action, the full trace (including how many and which items
were filtered), and can verify the hash chain. They don't read restricted *content* through the
log: answers are stored masked, and claim statements are stripped from trace details.
"""

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from brain.api.deps import Auditor, Member
from brain.audit import log as audit
from brain.db.models import AuditLog, TraceEvent, User
from brain.db.session import global_session, tenant_session

router = APIRouter(tags=["audit"])


class AuditRowOut(BaseModel):
    seq: int
    ts: datetime
    event_type: str
    query_id: str | None
    actor_user_id: str | None
    actor_name: str | None
    channel: str | None
    query_text: str | None
    language: str | None
    intent: str | None
    permission_version: int | None
    roles_snapshot: list[str]
    retrieved_item_ids: list[str]
    filtered_count: int | None
    decision_path: str | None
    response_text: str | None
    citations: list[str]
    model_ids: dict | None
    prompt_version: str | None
    latency_ms: int | None
    details: dict | None
    row_hash: str


class TraceStepOut(BaseModel):
    step: int
    label: str
    name: str
    ms: int | None
    summary: str | None
    detail: dict | None = None  # auditor view only
    started_at: datetime | None = None  # auditor view only: drives the timeline


class QueryDetailOut(BaseModel):
    audit: AuditRowOut
    trace: list[TraceStepOut]


class VerifyOut(BaseModel):
    ok: bool
    rows: int
    first_bad_seq: int | None
    verified_at: datetime


class SummaryOut(BaseModel):
    since: datetime
    queries: int
    by_decision: dict[str, int]
    by_channel: dict[str, int]
    p50_latency_ms: int | None
    p95_latency_ms: int | None
    admin_events: int
    total_filtered: int


async def _names(user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    async with global_session() as s:
        return dict(
            (await s.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()
        )


def _row(r: AuditLog, names: dict) -> AuditRowOut:
    return AuditRowOut(
        seq=r.seq, ts=r.ts, event_type=r.event_type, query_id=str(r.query_id) if r.query_id else None,
        actor_user_id=str(r.actor_user_id) if r.actor_user_id else None, actor_name=names.get(r.actor_user_id),
        channel=r.channel, query_text=r.query_text, language=r.language, intent=r.intent,
        permission_version=r.permission_version, roles_snapshot=r.roles_snapshot, retrieved_item_ids=r.retrieved_item_ids,
        filtered_count=r.filtered_count, decision_path=r.decision_path, response_text=r.response_text,
        citations=r.citations, model_ids=r.model_ids, prompt_version=r.prompt_version, latency_ms=r.latency_ms,
        details=r.details, row_hash=r.row_hash,
    )  # fmt: skip


def _redact(detail: dict | None) -> dict | None:
    """Keep IDs, counts, values and decisions; drop content excerpts (claim statements)."""
    if not detail:
        return detail
    out = dict(detail)
    if "claims" in out:
        out["claims"] = [{k: v for k, v in c.items() if k != "statement"} for c in out["claims"]]
    return out


def _ms(t: TraceEvent) -> int | None:
    return int((t.ended_at - t.started_at).total_seconds() * 1000) if t.ended_at else None


@router.get("/audit/log")
async def audit_log(
    ctx: Auditor,
    event_type: str | None = None,
    exclude_queries: bool = False,  # admin/upload/membership events only
    decision_path: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    channel: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    before_seq: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AuditRowOut]:
    conds = []
    if event_type:
        conds.append(AuditLog.event_type == event_type)
    if exclude_queries:
        conds.append(AuditLog.event_type != "query")
    if decision_path:
        conds.append(AuditLog.decision_path == decision_path)
    if actor_user_id:
        conds.append(AuditLog.actor_user_id == actor_user_id)
    if channel:
        conds.append(AuditLog.channel == channel)
    if q:
        conds.append(AuditLog.query_text.ilike(f"%{q}%"))
    if before_seq:
        conds.append(AuditLog.seq < before_seq)
    async with tenant_session(ctx.tenant_id) as s:
        rows = (
            await s.scalars(
                select(AuditLog).where(*conds).order_by(AuditLog.seq.desc()).limit(limit)
            )
        ).all()
    names = await _names({r.actor_user_id for r in rows if r.actor_user_id})
    return [_row(r, names) for r in rows]


@router.get("/audit/queries/{query_id}")
async def audit_query(query_id: uuid.UUID, ctx: Auditor) -> QueryDetailOut:
    async with tenant_session(ctx.tenant_id) as s:
        row = await s.scalar(select(AuditLog).where(AuditLog.query_id == query_id))
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "query_not_found")
        steps = (
            await s.scalars(
                select(TraceEvent).where(TraceEvent.query_id == query_id).order_by(TraceEvent.step)
            )
        ).all()
    names = await _names({row.actor_user_id} if row.actor_user_id else set())
    return QueryDetailOut(
        audit=_row(row, names),
        trace=[
            TraceStepOut(
                step=t.step,
                label=t.label,
                name=t.name,
                ms=_ms(t),
                summary=t.summary_user,
                detail=_redact(t.detail_auditor),
                started_at=t.started_at,
            )
            for t in steps
        ],  # fmt: skip
    )


@router.post("/audit/verify")
async def verify(ctx: Auditor) -> VerifyOut:
    """Recompute the whole hash chain; the check itself is recorded (after verifying)."""
    async with tenant_session(ctx.tenant_id) as s:
        check = await audit.verify_chain(s)
        await audit.append(
            s, ctx.tenant_id, "audit", actor_user_id=ctx.user_id, channel="web",
            permission_version=ctx.permission_version, roles_snapshot=sorted(ctx.role_keys),
            details={"action": "audit.verify", "ok": check.ok, "rows": check.rows, "first_bad_seq": check.first_bad_seq},
        )  # fmt: skip
    return VerifyOut(
        ok=check.ok,
        rows=check.rows,
        first_bad_seq=check.first_bad_seq,
        verified_at=datetime.now().astimezone(),
    )


@router.get("/audit/summary")
async def summary(ctx: Auditor, days: int = Query(default=7, ge=1, le=90)) -> SummaryOut:
    since = datetime.now().astimezone() - timedelta(days=days)
    async with tenant_session(ctx.tenant_id) as s:
        base = select(AuditLog).where(AuditLog.ts >= since)
        q = base.where(AuditLog.event_type == "query").subquery()
        by_decision = dict(
            (
                await s.execute(select(q.c.decision_path, func.count()).group_by(q.c.decision_path))
            ).all()
        )
        by_channel = dict(
            (await s.execute(select(q.c.channel, func.count()).group_by(q.c.channel))).all()
        )
        p50, p95, filtered = (
            await s.execute(
                select(
                    func.percentile_cont(0.5).within_group(q.c.latency_ms),
                    func.percentile_cont(0.95).within_group(q.c.latency_ms),
                    func.coalesce(func.sum(q.c.filtered_count), 0),
                )
            )
        ).one()
        admin = await s.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.ts >= since, AuditLog.event_type == "admin")
        )
    return SummaryOut(
        since=since, queries=sum(by_decision.values()), by_decision={k or "none": v for k, v in by_decision.items()},
        by_channel={k or "none": v for k, v in by_channel.items()},
        p50_latency_ms=int(p50) if p50 is not None else None, p95_latency_ms=int(p95) if p95 is not None else None,
        admin_events=admin, total_filtered=int(filtered),
    )  # fmt: skip


@router.get("/queries/{query_id}/trace")
async def my_trace(query_id: uuid.UUID, ctx: Member) -> list[TraceStepOut]:
    """The user's own trace: step labels, timings and post-filter summaries only (14.2).
    Someone else's query, or an unknown one, is the same 404."""
    async with tenant_session(ctx.tenant_id) as s:
        owner = await s.scalar(select(AuditLog.actor_user_id).where(AuditLog.query_id == query_id))
        if owner != ctx.user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "query_not_found")
        steps = (
            await s.scalars(
                select(TraceEvent).where(TraceEvent.query_id == query_id).order_by(TraceEvent.step)
            )
        ).all()
    return [
        TraceStepOut(step=t.step, label=t.label, name=t.name, ms=_ms(t), summary=t.summary_user)
        for t in steps
    ]
