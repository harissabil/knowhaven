from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from brain.api.deps import Auth
from brain.auth.sessions import (
    AuthSession,
    clear_cookie,
    create_session,
    delete_session,
    get_session,
    set_cookie,
)
from brain.db.models import User
from brain.db.session import global_session, tenant_session
from brain.hitl.approvers import is_approver
from brain.rbac.context import load_context
from brain.security import hash_password, verify_password
from brain.tenancy.service import list_my_memberships

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MembershipOut(BaseModel):
    tenant_id: str
    tenant_name: str
    status: str


class ActiveTenantOut(BaseModel):
    tenant_id: str
    tenant_name: str
    status: str
    roles: list[str]
    permission_version: int
    can_approve: bool  # admin, manager, topic owner or container owner (12.3): shows Approvals


class MeOut(BaseModel):
    user_id: str
    email: str
    name: str
    csrf_token: str
    active_tenant: ActiveTenantOut | None
    memberships: list[MembershipOut]


async def build_me(auth: AuthSession) -> MeOut:
    async with global_session() as s:
        memberships = await list_my_memberships(s, auth.user_id)
    active = None
    match = next((m for m in memberships if m.tenant_id == auth.active_tenant_id), None)
    if match is not None:
        async with tenant_session(match.tenant_id) as s:
            ctx = await load_context(s, match.tenant_id, auth.user_id)
        if ctx is not None:
            active = ActiveTenantOut(
                tenant_id=str(ctx.tenant_id),
                tenant_name=match.tenant_name,
                status=ctx.membership_status,
                roles=sorted(ctx.role_keys),
                permission_version=ctx.permission_version,
                can_approve=ctx.is_active and await is_approver(s, ctx),
            )
    return MeOut(
        user_id=str(auth.user_id),
        email=auth.email,
        name=auth.name,
        csrf_token=auth.csrf_token,
        active_tenant=active,
        memberships=[
            MembershipOut(tenant_id=str(m.tenant_id), tenant_name=m.tenant_name, status=m.status)
            for m in memberships
        ],
    )


async def _login(response: Response, user_id) -> MeOut:
    async with global_session() as s:
        memberships = await list_my_memberships(s, user_id)
        first = next((m.tenant_id for m in memberships if m.status == "active"), None)
        token = await create_session(s, user_id, first)
        auth = await get_session(s, token)
    set_cookie(response, token)
    return await build_me(auth)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, response: Response) -> MeOut:
    try:
        async with global_session() as s:
            user = User(
                email=body.email.lower(),
                name=body.name.strip(),
                password_hash=hash_password(body.password),
            )
            s.add(user)
            await s.flush()
    except IntegrityError:
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken") from None
    return await _login(response, user.id)


@router.post("/login")
async def login(body: LoginIn, response: Response) -> MeOut:
    async with global_session() as s:
        user = await s.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    # Same error and (via a dummy hash) similar timing for unknown email and wrong password.
    # No name-prefix lookup and no shared demo passwords: identity is email + that user's password.
    if not verify_password(user.password_hash if user else None, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_credentials")
    return await _login(response, user.id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(auth: Auth, response: Response) -> None:
    async with global_session() as s:
        await delete_session(s, auth.session_id)
    clear_cookie(response)


@me_router.get("/me")
async def me(auth: Auth) -> MeOut:
    return await build_me(auth)
