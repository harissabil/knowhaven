"""Human-in-the-loop approvals API: access requests (12.1) and action drafts (12.2)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.api.deps import Member
from brain.db.models import AccessRequest, ActionDraft, Container, TopicOwner, User
from brain.db.session import global_session, tenant_session
from brain.hitl import access, drafts
from brain.hitl.access import HitlError

router = APIRouter(prefix="/approvals", tags=["approvals"])

_STATUS = {
    "topic_not_requestable": status.HTTP_404_NOT_FOUND,
    "request_not_found": status.HTTP_404_NOT_FOUND,
    "draft_not_found": status.HTTP_404_NOT_FOUND,
    "self_approval_forbidden": status.HTTP_403_FORBIDDEN,
    "already_has_access": status.HTTP_409_CONFLICT,
    "request_already_pending": status.HTTP_409_CONFLICT,
    "already_decided": status.HTTP_409_CONFLICT,
    "target_changed_since_draft": status.HTTP_409_CONFLICT,
    "no_approver": status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _hitl_error(e: HitlError) -> HTTPException:
    return HTTPException(_STATUS.get(e.code, status.HTTP_400_BAD_REQUEST), e.code)


class AccessRequestIn(BaseModel):
    topic_key: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=1000)


class AccessApproveIn(BaseModel):
    days: int = Field(default=7, ge=1, le=90)


class AccessRejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AccessRequestOut(BaseModel):
    id: str
    topic_key: str
    topic_name: str | None = None
    container_id: str | None = None
    container_name: str | None = None
    requester_id: str
    requester_name: str | None = None
    requester_email: str | None = None
    reason: str
    status: str
    approver_id: str | None = None
    approver_name: str | None = None
    decided_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime


class DraftRejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class DraftEditIn(BaseModel):
    new_value: str | None = Field(default=None, max_length=200)
    new_text: str | None = Field(default=None, max_length=10000)


class ActionDraftOut(BaseModel):
    id: str
    kind: str
    target_system: str
    target_ref: str
    target_title: str | None = None
    payload: dict
    diff: str
    evidence_ids: list[str]
    created_by_query_id: str | None = None
    status: str
    approver_id: str | None = None
    approver_name: str | None = None
    decided_at: datetime | None = None
    executed_at: datetime | None = None
    exec_result: dict | None = None
    created_at: datetime


class ExpireGrantsOut(BaseModel):
    expired_count: int


async def _enrich_access_requests(
    tenant_s: AsyncSession, reqs: list[AccessRequest]
) -> list[AccessRequestOut]:
    if not reqs:
        return []
    user_ids = {r.requester_id for r in reqs if r.requester_id} | {
        r.approver_id for r in reqs if r.approver_id
    }
    user_map: dict[uuid.UUID, tuple[str, str]] = {}
    if user_ids:
        async with global_session() as gs:
            q = select(User.id, User.name, User.email).where(User.id.in_(user_ids))
            rows = (await gs.execute(q)).all()
            user_map = {row.id: (row.name, row.email) for row in rows}

    topic_keys = {r.topic_key for r in reqs if r.topic_key}
    topic_map: dict[str, str] = {}
    if topic_keys:
        t_rows = (
            await tenant_s.execute(
                select(TopicOwner.topic_key, TopicOwner.display_name).where(
                    TopicOwner.topic_key.in_(topic_keys)
                )
            )
        ).all()
        topic_map = {row.topic_key: row.display_name for row in t_rows}

    container_ids = {r.container_id for r in reqs if r.container_id}
    container_map: dict[uuid.UUID, str] = {}
    if container_ids:
        c_rows = (
            await tenant_s.execute(
                select(Container.id, Container.name).where(Container.id.in_(container_ids))
            )
        ).all()
        container_map = {row.id: row.name for row in c_rows}

    out = []
    for r in reqs:
        req_u = user_map.get(r.requester_id)
        app_u = user_map.get(r.approver_id) if r.approver_id else None
        out.append(
            AccessRequestOut(
                id=str(r.id),
                topic_key=r.topic_key,
                topic_name=topic_map.get(r.topic_key, r.topic_key.replace("_", " ").title()),
                container_id=str(r.container_id) if r.container_id else None,
                container_name=container_map.get(r.container_id),
                requester_id=str(r.requester_id),
                requester_name=req_u[0] if req_u else None,
                requester_email=req_u[1] if req_u else None,
                reason=r.reason,
                status=r.status,
                approver_id=str(r.approver_id) if r.approver_id else None,
                approver_name=app_u[0] if app_u else None,
                decided_at=r.decided_at,
                expires_at=r.expires_at,
                created_at=r.created_at,
            )
        )
    return out


async def _enrich_drafts(
    tenant_s: AsyncSession, drafts_list: list[ActionDraft]
) -> list[ActionDraftOut]:
    if not drafts_list:
        return []
    approver_ids = {d.approver_id for d in drafts_list if d.approver_id}
    app_map: dict[uuid.UUID, str] = {}
    if approver_ids:
        async with global_session() as gs:
            rows = (
                await gs.execute(select(User.id, User.name).where(User.id.in_(approver_ids)))
            ).all()
            app_map = {row.id: row.name for row in rows}

    out = []
    for d in drafts_list:
        title = d.payload.get("title") if isinstance(d.payload, dict) else None
        if not title:
            base = d.target_ref.split("/")[-1].replace(".md", "").replace("-", " ").title()
            title = f"{d.target_system.title()}: {base}"
        out.append(
            ActionDraftOut(
                id=str(d.id),
                kind=d.kind,
                target_system=d.target_system,
                target_ref=d.target_ref,
                target_title=title,
                payload=d.payload or {},
                diff=d.diff,
                evidence_ids=d.evidence_ids or [],
                created_by_query_id=str(d.created_by_query_id) if d.created_by_query_id else None,
                status=d.status,
                approver_id=str(d.approver_id) if d.approver_id else None,
                approver_name=app_map.get(d.approver_id) if d.approver_id else None,
                decided_at=d.decided_at,
                executed_at=d.executed_at,
                exec_result=d.exec_result,
                created_at=d.created_at,
            )
        )
    return out


@router.post("/access-requests", status_code=status.HTTP_201_CREATED)
async def create_access_request(body: AccessRequestIn, ctx: Member) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.request_access(s, ctx, body.topic_key, body.reason)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_access_requests(s, [req]))[0]


@router.get("/access-requests")
async def list_access_requests(
    ctx: Member, mine: bool = False, status: str | None = None
) -> list[AccessRequestOut]:
    async with tenant_session(ctx.tenant_id) as s:
        reqs = await access.list_access_requests(s, ctx, mine=mine, status=status)
        return await _enrich_access_requests(s, reqs)


@router.get("/access-requests/{request_id}")
async def get_access_request(request_id: uuid.UUID, ctx: Member) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.get_access_request(s, ctx, request_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_access_requests(s, [req]))[0]


@router.post("/access-requests/{request_id}/approve")
async def approve_access_request(
    request_id: uuid.UUID, body: AccessApproveIn, ctx: Member
) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.approve(s, ctx, request_id, body.days)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_access_requests(s, [req]))[0]


@router.post("/access-requests/{request_id}/reject")
async def reject_access_request(
    request_id: uuid.UUID, body: AccessRejectIn, ctx: Member
) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.reject(s, ctx, request_id, body.note)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_access_requests(s, [req]))[0]


@router.get("/drafts")
async def list_drafts(ctx: Member, status: str | None = None) -> list[ActionDraftOut]:
    async with tenant_session(ctx.tenant_id) as s:
        draft_list = await drafts.list_drafts(s, ctx, status=status)
        return await _enrich_drafts(s, draft_list)


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: uuid.UUID, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.get_draft(s, ctx, draft_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_drafts(s, [draft]))[0]


@router.post("/drafts/{draft_id}/approve")
async def approve_draft(draft_id: uuid.UUID, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.approve(s, ctx, draft_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_drafts(s, [draft]))[0]


@router.post("/drafts/{draft_id}/reject")
async def reject_draft(draft_id: uuid.UUID, body: DraftRejectIn, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.reject(s, ctx, draft_id, body.note)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_drafts(s, [draft]))[0]


@router.patch("/drafts/{draft_id}")
async def edit_draft(draft_id: uuid.UUID, body: DraftEditIn, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.edit(s, ctx, draft_id, body.new_value, body.new_text)
        except HitlError as e:
            raise _hitl_error(e) from e
        return (await _enrich_drafts(s, [draft]))[0]


@router.post("/expire-grants")
async def trigger_expire_grants(ctx: Member) -> ExpireGrantsOut:
    async with tenant_session(ctx.tenant_id) as s:
        count = await access.expire_grants(s, ctx.tenant_id)
        return ExpireGrantsOut(expired_count=count)
