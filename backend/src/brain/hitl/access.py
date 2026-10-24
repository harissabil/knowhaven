"""Access requests for gated topics (design doc 12.1, T14)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from brain.audit import log as audit
from brain.db.models import AccessRequest, Container, TempGrant, TopicOwner
from brain.hitl import approvers
from brain.rbac.context import RequestContext
from brain.rbac.state import bump_permission_version
from brain.rbac.visibility import visible_container_clause


class HitlError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


async def request_access(
    s: AsyncSession, ctx: RequestContext, topic_key: str, reason: str
) -> AccessRequest:
    topic = await s.scalar(select(TopicOwner).where(TopicOwner.topic_key == topic_key))
    # Only public, gated topics can be requested: hidden topics aren't in topic_owners at all,
    # so this endpoint can't be used to probe for them (8.2).
    if topic is None or topic.tier != "gated" or topic.container_id is None:
        raise HitlError("topic_not_requestable")
    if await s.scalar(
        select(Container.id).where(
            Container.id == topic.container_id, visible_container_clause(ctx)
        )
    ):
        raise HitlError("already_has_access")
    pending = await s.scalar(
        select(AccessRequest).where(
            AccessRequest.requester_id == ctx.user_id,
            AccessRequest.topic_key == topic_key,
            AccessRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HitlError("request_already_pending")
    if not await approvers.for_access(s, topic_key, topic.container_id, ctx.user_id):
        raise HitlError("no_approver")
    req = AccessRequest(tenant_id=ctx.tenant_id, requester_id=ctx.user_id, topic_key=topic_key,
                        container_id=topic.container_id, reason=reason.strip())  # fmt: skip
    s.add(req)
    await s.flush()
    await audit.append(
        s, ctx.tenant_id, "approval", actor_user_id=ctx.user_id, channel="web", permission_version=ctx.permission_version,
        roles_snapshot=sorted(ctx.role_keys), details={"action": "access.request", "request_id": str(req.id), "topic_key": topic_key},
    )  # fmt: skip
    return req


async def _load_for_decision(
    s: AsyncSession, ctx: RequestContext, request_id: uuid.UUID
) -> AccessRequest:
    req = await s.scalar(
        select(AccessRequest).where(AccessRequest.id == request_id).with_for_update()
    )
    if req is not None and req.requester_id == ctx.user_id:
        raise HitlError("self_approval_forbidden")  # the requester knows it exists; nothing to hide
    if req is None or ctx.user_id not in await approvers.for_access(
        s, req.topic_key, req.container_id, req.requester_id
    ):
        raise HitlError("request_not_found")  # not yours to decide looks the same as not existing
    if req.status != "pending":
        raise HitlError("already_decided")
    return req


async def approve(
    s: AsyncSession, ctx: RequestContext, request_id: uuid.UUID, days: int
) -> AccessRequest:
    req = await _load_for_decision(s, ctx, request_id)
    expires = datetime.now(UTC) + timedelta(days=days)
    req.status, req.approver_id, req.decided_at, req.expires_at = (
        "approved",
        ctx.user_id,
        func.now(),
        expires,
    )
    s.add(TempGrant(tenant_id=ctx.tenant_id, user_id=req.requester_id, container_id=req.container_id,
                    granted_by=ctx.user_id, access_request_id=req.id, expires_at=expires))  # fmt: skip
    version = await bump_permission_version(s, ctx.tenant_id)
    await audit.admin_event(s, ctx, "access.approve", permission_version=version, request_id=req.id,
                            requester_id=req.requester_id, topic_key=req.topic_key, expires_at=expires)  # fmt: skip
    return req


async def reject(
    s: AsyncSession, ctx: RequestContext, request_id: uuid.UUID, note: str | None
) -> AccessRequest:
    req = await _load_for_decision(s, ctx, request_id)
    req.status, req.approver_id, req.decided_at = "rejected", ctx.user_id, func.now()
    await audit.admin_event(s, ctx, "access.reject", request_id=req.id, requester_id=req.requester_id,
                            topic_key=req.topic_key, note=note)  # fmt: skip
    return req


async def expire_grants(s: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Mark approved requests whose grant ran out as expired and bump the permission version so
    open conversations recompute (8.5). Grants are already ignored after expires_at."""
    res = await s.execute(
        update(AccessRequest)
        .where(AccessRequest.status == "approved", AccessRequest.expires_at <= func.now())
        .values(status="expired")
    )
    if res.rowcount:
        await bump_permission_version(s, tenant_id)
    return res.rowcount
