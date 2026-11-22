"""What a member may do in the app, computed from the same rules the endpoints enforce (4.3, 12.3).

Used to describe a member's own access to them (Havi's ME-access source) and to pick which app-guide
articles they get. Endpoints keep their own checks; this module only reuses those rules.
"""

from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Manager, PiiPermission
from brain.hitl.approvers import is_approver
from brain.rbac.context import RequestContext

AUDIENCES = ("everyone", "admin", "uploader", "approver", "auditor")


async def may_upload(s: AsyncSession, ctx: RequestContext) -> bool:
    """Admins, HR, and anyone who manages something may add files (4.3)."""
    if ctx.is_admin or "hr" in ctx.role_keys:
        return True
    return bool(await s.scalar(select(exists().where(Manager.manager_user_id == ctx.user_id))))


@dataclass(frozen=True)
class Caps:
    admin: bool = False
    upload: bool = False
    approve: bool = False
    audit: bool = False
    pii: frozenset[str] = frozenset()  # personal-data types shown unmasked when a task needs them

    def allows(self, audience: str) -> bool:
        return {
            "everyone": True,
            "admin": self.admin,
            "uploader": self.upload,
            "approver": self.approve,
            "auditor": self.audit,
        }[audience]


async def capabilities(s: AsyncSession, ctx: RequestContext) -> Caps:
    """`s` is scoped to ctx.tenant_id. A pending member can do nothing yet."""
    if not ctx.is_active:
        return Caps()
    pii = (
        frozenset(
            await s.scalars(
                select(PiiPermission.pii_type).where(
                    PiiPermission.role_id.in_(sorted(ctx.business_role_ids))
                )
            )
        )
        if ctx.business_role_ids
        else frozenset()
    )
    return Caps(
        admin=ctx.is_admin,
        upload=await may_upload(s, ctx),
        approve=await is_approver(s, ctx),
        audit="auditor" in ctx.role_keys,
        pii=pii,
    )
