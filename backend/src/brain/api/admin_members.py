"""Owner/Admin: members (approve/reject/remove), invites, company join code (4.4 A, 14.1)."""

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from brain.api.deps import Admin
from brain.api.errors import http_error
from brain.audit import log as audit
from brain.config import get_settings
from brain.db.models import Invite, MemberProfile, Membership, Role, Tenant, User, UserRole
from brain.db.session import global_session, tenant_session
from brain.security import decrypt
from brain.tenancy import service
from brain.tenancy.service import TenancyError

router = APIRouter(prefix="/admin", tags=["admin"])


class MemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    status: str
    roles: list[str]
    department: str | None
    title: str | None
    joined_at: datetime


class ApproveIn(BaseModel):
    role_ids: list[uuid.UUID] = Field(min_length=1)


class InviteIn(BaseModel):
    role_id: uuid.UUID
    expires_in_days: int = Field(default=7, ge=1, le=30)
    max_uses: int = Field(default=1, ge=1, le=100)


class InviteOut(BaseModel):
    id: str
    role_id: str
    role_key: str
    expires_at: datetime
    max_uses: int
    used_count: int
    revoked: bool
    link: str | None = None  # only in the create response


class JoinCodeOut(BaseModel):
    join_code: str


@router.get("/members")
async def list_members(ctx: Admin) -> list[MemberOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = (
            await s.execute(
                select(Membership, MemberProfile.department, MemberProfile.title)
                .outerjoin(
                    MemberProfile,
                    (MemberProfile.user_id == Membership.user_id)
                    & (MemberProfile.tenant_id == Membership.tenant_id),
                )
                .where(Membership.status != "removed")
                .order_by(Membership.status.desc(), Membership.joined_at)
            )
        ).all()
        roles = (
            await s.execute(
                select(UserRole.user_id, Role.key).join(
                    Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id)
                )
            )
        ).all()
    # users is a global table: fetch only the members of this tenant.
    async with global_session() as s:
        users = {
            u.id: u
            for u in await s.scalars(
                select(User).where(User.id.in_([m.user_id for m, _, _ in rows]))
            )
        }
    by_user: dict[uuid.UUID, list[str]] = {}
    for user_id, key in roles:
        by_user.setdefault(user_id, []).append(key)
    return [
        MemberOut(
            user_id=str(m.user_id),
            name=users[m.user_id].name,
            email=users[m.user_id].email,
            status=m.status,
            roles=sorted(by_user.get(m.user_id, [])),
            department=dept,
            title=title,
            joined_at=m.joined_at,
        )
        for m, dept, title in rows
    ]


@router.post("/members/{user_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve(user_id: uuid.UUID, body: ApproveIn, ctx: Admin) -> None:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            keys = set(await s.scalars(select(Role.key).where(Role.id.in_(body.role_ids))))
            if "owner" in keys and "owner" not in ctx.role_keys:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "owner_required")
            await service.approve_member(s, ctx.tenant_id, user_id, body.role_ids, ctx.user_id)
            await audit.admin_event(s, ctx, "member.approve", user_id=user_id, roles=sorted(keys))
    except TenancyError as e:
        raise http_error(e) from None


@router.post("/members/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject(user_id: uuid.UUID, ctx: Admin) -> None:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            await service.reject_member(s, user_id)
            await audit.admin_event(s, ctx, "member.reject", user_id=user_id)
    except TenancyError as e:
        raise http_error(e) from None


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(user_id: uuid.UUID, ctx: Admin) -> None:
    if user_id == ctx.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "use_leave_endpoint")
    try:
        async with tenant_session(ctx.tenant_id) as s:
            await service.remove_member(s, ctx.tenant_id, user_id)
            await audit.admin_event(s, ctx, "member.remove", user_id=user_id)
    except TenancyError as e:
        raise http_error(e) from None


def _invite_out(invite: Invite, role_key: str, link: str | None = None) -> InviteOut:
    return InviteOut(
        id=str(invite.id),
        role_id=str(invite.default_role_id),
        role_key=role_key,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
        revoked=invite.revoked_at is not None,
        link=link,
    )


@router.get("/invites")
async def list_invites(ctx: Admin) -> list[InviteOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = (
            await s.execute(
                select(Invite, Role.key)
                .join(
                    Role, (Role.id == Invite.default_role_id) & (Role.tenant_id == Invite.tenant_id)
                )
                .order_by(Invite.created_at.desc())
            )
        ).all()
    return [_invite_out(i, key) for i, key in rows]


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(body: InviteIn, ctx: Admin) -> InviteOut:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            invite, token = await service.create_invite(
                s,
                ctx.tenant_id,
                body.role_id,
                ctx.user_id,
                timedelta(days=body.expires_in_days),
                body.max_uses,
            )
            role_key = await s.scalar(select(Role.key).where(Role.id == body.role_id))
            await audit.admin_event(
                s, ctx, "invite.create", invite_id=invite.id, role=role_key, max_uses=body.max_uses
            )
    except TenancyError as e:
        raise http_error(e) from None
    link = f"{get_settings().web_origin}/join/{token}"
    return _invite_out(invite, role_key, link)


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(invite_id: uuid.UUID, ctx: Admin) -> None:
    async with tenant_session(ctx.tenant_id) as s:
        result = await s.execute(
            update(Invite)
            .where(Invite.id == invite_id, Invite.revoked_at.is_(None))
            .values(revoked_at=func.now())
        )
        if result.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "invite_not_found")
        await audit.admin_event(s, ctx, "invite.revoke", invite_id=invite_id)


@router.get("/join-code")
async def get_join_code(ctx: Admin) -> JoinCodeOut:
    async with tenant_session(ctx.tenant_id) as s:
        encrypted = await s.scalar(select(Tenant.join_code_encrypted))
    return JoinCodeOut(join_code=decrypt(encrypted))


@router.post("/join-code/rotate")
async def rotate_join_code(ctx: Admin) -> JoinCodeOut:
    async with tenant_session(ctx.tenant_id) as s:
        code = await service.rotate_join_code(s, ctx.tenant_id)
        await audit.admin_event(s, ctx, "join_code.rotate")
    return JoinCodeOut(join_code=code)


class RoleOut(BaseModel):
    id: str
    key: str
    name: str
    is_system: bool


@router.get("/roles")
async def list_roles(ctx: Admin) -> list[RoleOut]:
    async with tenant_session(ctx.tenant_id) as s:
        roles = (await s.scalars(select(Role).order_by(Role.is_system.desc(), Role.name))).all()
    return [RoleOut(id=str(r.id), key=r.key, name=r.name, is_system=r.is_system) for r in roles]


class TenantSettingsIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    default_contact: str | None = Field(default=None, min_length=1, max_length=200)
    # Public company facts (founded, address, what the company does...). Visible to every member.
    profile: str | None = Field(default=None, max_length=4000)


class TenantSettingsOut(BaseModel):
    name: str
    slug: str
    default_contact: str | None
    profile: str | None


@router.get("/tenant")
async def get_tenant_settings(ctx: Admin) -> TenantSettingsOut:
    async with tenant_session(ctx.tenant_id) as s:
        t = await s.scalar(select(Tenant))
    return TenantSettingsOut(
        name=t.name, slug=t.slug, default_contact=t.default_contact, profile=t.profile
    )


@router.patch("/tenant")
async def update_tenant_settings(body: TenantSettingsIn, ctx: Admin) -> TenantSettingsOut:
    changes = body.model_dump(exclude_unset=True)
    async with tenant_session(ctx.tenant_id) as s:
        t = await s.scalar(select(Tenant))
        for k, v in changes.items():
            setattr(t, k, v)
        await audit.admin_event(s, ctx, "tenant.update", fields=sorted(changes))
    return TenantSettingsOut(
        name=t.name, slug=t.slug, default_contact=t.default_contact, profile=t.profile
    )
