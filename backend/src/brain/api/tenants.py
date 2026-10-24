import uuid
from dataclasses import replace

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from brain.api.auth import MeOut, build_me
from brain.api.deps import Auth, Context, Member
from brain.api.errors import http_error
from brain.auth.sessions import set_active_tenant
from brain.db.session import global_session, tenant_session
from brain.tenancy import service
from brain.tenancy.service import TenancyError

router = APIRouter(tags=["tenants"])


class CreateTenantIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class CreateTenantOut(BaseModel):
    tenant_id: str
    join_code: str
    me: MeOut


class SwitchIn(BaseModel):
    tenant_id: uuid.UUID


class JoinCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)


class JoinOut(BaseModel):
    tenant_id: str
    tenant_name: str
    status: str  # active | pending


class ContextOut(BaseModel):
    tenant_id: str
    status: str
    roles: list[str]
    permission_version: int


@router.post("/tenants", status_code=status.HTTP_201_CREATED)
async def create_tenant(body: CreateTenantIn, auth: Auth) -> CreateTenantOut:
    """Any logged-in user can create a company and becomes its Owner + Admin (4.3)."""
    tenant_id = uuid.uuid4()
    async with tenant_session(tenant_id) as s:
        code = await service.create_tenant(s, tenant_id, body.name, auth.user_id)
    async with global_session() as s:
        await set_active_tenant(s, auth.session_id, tenant_id)
    me = await build_me(replace(auth, active_tenant_id=tenant_id))
    return CreateTenantOut(tenant_id=str(tenant_id), join_code=code, me=me)


@router.post("/tenants/switch")
async def switch_tenant(body: SwitchIn, auth: Auth) -> MeOut:
    """The client may *ask* for a tenant; membership is verified server-side before it's stored."""
    async with global_session() as s:
        mine = await service.list_my_memberships(s, auth.user_id)
        if body.tenant_id not in {m.tenant_id for m in mine}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not_a_member")
        await set_active_tenant(s, auth.session_id, body.tenant_id)
    return await build_me(replace(auth, active_tenant_id=body.tenant_id))


@router.post("/tenants/join-code")
async def join_by_code(body: JoinCodeIn, auth: Auth) -> JoinOut:
    async with global_session() as s:
        resolved = await service.resolve_join_code(s, body.code)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "join_code_invalid")
    async with tenant_session(resolved.tenant_id) as s:
        state = await service.request_join(s, resolved.tenant_id, auth.user_id)
    async with global_session() as s:
        await set_active_tenant(s, auth.session_id, resolved.tenant_id)
    return JoinOut(
        tenant_id=str(resolved.tenant_id), tenant_name=resolved.tenant_name, status=state
    )


@router.post("/join/{token}")
async def accept_invite(token: str, auth: Auth) -> JoinOut:
    async with global_session() as s:
        resolved = await service.resolve_invite(s, token)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite_invalid")
    invite_id, tenant_id, tenant_name = resolved
    try:
        async with tenant_session(tenant_id) as s:
            state = await service.accept_invite(s, tenant_id, invite_id, auth.user_id)
    except TenancyError as e:
        raise http_error(e) from None
    async with global_session() as s:
        await set_active_tenant(s, auth.session_id, tenant_id)
    return JoinOut(tenant_id=str(tenant_id), tenant_name=tenant_name, status=state)


@router.post("/tenants/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_tenant(ctx: Context, auth: Auth) -> None:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            await service.remove_member(s, ctx.tenant_id, ctx.user_id)
    except TenancyError as e:
        raise http_error(e) from None
    async with global_session() as s:
        await set_active_tenant(s, auth.session_id, None)


@router.get("/context")
async def context(ctx: Member) -> ContextOut:
    """Active member's identity in the current tenant (also what `whoami` will return)."""
    return ContextOut(
        tenant_id=str(ctx.tenant_id),
        status=ctx.membership_status,
        roles=sorted(ctx.role_keys),
        permission_version=ctx.permission_version,
    )
