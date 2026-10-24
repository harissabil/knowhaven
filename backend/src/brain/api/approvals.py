"""Human-in-the-loop approvals API: access requests (12.1) and action drafts (12.2)."""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from brain.api.deps import Member
from brain.db.models import AccessRequest, ActionDraft
from brain.db.session import tenant_session
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
    container_id: str | None
    requester_id: str
    reason: str
    status: str
    approver_id: str | None
    decided_at: datetime | None
    expires_at: datetime | None
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
    payload: dict
    diff: str
    evidence_ids: list[str]
    created_by_query_id: str | None
    status: str
    approver_id: str | None
    decided_at: datetime | None
    executed_at: datetime | None
    exec_result: dict | None
    created_at: datetime


class ExpireGrantsOut(BaseModel):
    expired_count: int


def _access_out(r: AccessRequest) -> AccessRequestOut:
    return AccessRequestOut(
        id=str(r.id),
        topic_key=r.topic_key,
        container_id=str(r.container_id) if r.container_id else None,
        requester_id=str(r.requester_id),
        reason=r.reason,
        status=r.status,
        approver_id=str(r.approver_id) if r.approver_id else None,
        decided_at=r.decided_at,
        expires_at=r.expires_at,
        created_at=r.created_at,
    )


def _draft_out(d: ActionDraft) -> ActionDraftOut:
    return ActionDraftOut(
        id=str(d.id),
        kind=d.kind,
        target_system=d.target_system,
        target_ref=d.target_ref,
        payload=d.payload,
        diff=d.diff,
        evidence_ids=d.evidence_ids or [],
        created_by_query_id=str(d.created_by_query_id) if d.created_by_query_id else None,
        status=d.status,
        approver_id=str(d.approver_id) if d.approver_id else None,
        decided_at=d.decided_at,
        executed_at=d.executed_at,
        exec_result=d.exec_result,
        created_at=d.created_at,
    )


@router.post("/access-requests", status_code=status.HTTP_201_CREATED)
async def create_access_request(body: AccessRequestIn, ctx: Member) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.request_access(s, ctx, body.topic_key, body.reason)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _access_out(req)


@router.get("/access-requests")
async def list_access_requests(
    ctx: Member, mine: bool = False, status: str | None = None
) -> list[AccessRequestOut]:
    async with tenant_session(ctx.tenant_id) as s:
        reqs = await access.list_access_requests(s, ctx, mine=mine, status=status)
        return [_access_out(r) for r in reqs]


@router.get("/access-requests/{request_id}")
async def get_access_request(request_id: uuid.UUID, ctx: Member) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.get_access_request(s, ctx, request_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _access_out(req)


@router.post("/access-requests/{request_id}/approve")
async def approve_access_request(
    request_id: uuid.UUID, body: AccessApproveIn, ctx: Member
) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.approve(s, ctx, request_id, body.days)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _access_out(req)


@router.post("/access-requests/{request_id}/reject")
async def reject_access_request(
    request_id: uuid.UUID, body: AccessRejectIn, ctx: Member
) -> AccessRequestOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            req = await access.reject(s, ctx, request_id, body.note)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _access_out(req)


@router.get("/drafts")
async def list_drafts(ctx: Member, status: str | None = None) -> list[ActionDraftOut]:
    async with tenant_session(ctx.tenant_id) as s:
        draft_list = await drafts.list_drafts(s, ctx, status=status)
        return [_draft_out(d) for d in draft_list]


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: uuid.UUID, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.get_draft(s, ctx, draft_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _draft_out(draft)


@router.post("/drafts/{draft_id}/approve")
async def approve_draft(draft_id: uuid.UUID, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.approve(s, ctx, draft_id)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _draft_out(draft)


@router.post("/drafts/{draft_id}/reject")
async def reject_draft(draft_id: uuid.UUID, body: DraftRejectIn, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.reject(s, ctx, draft_id, body.note)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _draft_out(draft)


@router.patch("/drafts/{draft_id}")
async def edit_draft(draft_id: uuid.UUID, body: DraftEditIn, ctx: Member) -> ActionDraftOut:
    async with tenant_session(ctx.tenant_id) as s:
        try:
            draft = await drafts.edit(s, ctx, draft_id, body.new_value, body.new_text)
        except HitlError as e:
            raise _hitl_error(e) from e
        return _draft_out(draft)


@router.post("/expire-grants")
async def trigger_expire_grants(ctx: Member) -> ExpireGrantsOut:
    async with tenant_session(ctx.tenant_id) as s:
        count = await access.expire_grants(s, ctx.tenant_id)
        return ExpireGrantsOut(expired_count=count)
