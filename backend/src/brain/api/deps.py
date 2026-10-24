"""Request dependencies. Identity comes only from the session cookie; the tenant only from the
session's active tenant. No dependency reads a role or tenant from headers, query or body."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from brain.auth.sessions import COOKIE_NAME, AuthSession, get_session
from brain.db.session import global_session, tenant_session
from brain.rbac.context import RequestContext, load_context

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "X-CSRF-Token"


async def get_auth(request: Request) -> AuthSession:
    token = request.cookies.get(COOKIE_NAME)
    auth = None
    if token:
        async with global_session() as s:
            auth = await get_session(s, token)
    if auth is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not_authenticated")
    if request.method in _UNSAFE and request.headers.get(CSRF_HEADER) != auth.csrf_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "csrf_failed")
    return auth


Auth = Annotated[AuthSession, Depends(get_auth)]


async def get_context(auth: Auth) -> RequestContext:
    """Active-tenant context (pending members included; use `Member` to require active)."""
    if auth.active_tenant_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "no_active_tenant")
    async with tenant_session(auth.active_tenant_id) as s:
        ctx = await load_context(s, auth.active_tenant_id, auth.user_id)
    if ctx is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_a_member")
    return ctx


Context = Annotated[RequestContext, Depends(get_context)]


async def get_member(ctx: Context) -> RequestContext:
    if not ctx.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "membership_pending")
    return ctx


Member = Annotated[RequestContext, Depends(get_member)]


async def get_admin(ctx: Member) -> RequestContext:
    if not ctx.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin_required")
    return ctx


Admin = Annotated[RequestContext, Depends(get_admin)]


async def get_auditor(ctx: Member) -> RequestContext:
    """Audit log and full traces are for the auditor role only (design doc 4.3); owner/admin
    configure the company but don't read the record of what others asked."""
    if "auditor" not in ctx.role_keys:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "auditor_required")
    return ctx


Auditor = Annotated[RequestContext, Depends(get_auditor)]
