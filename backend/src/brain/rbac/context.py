"""Per-request identity + permissions, always read fresh from the DB (design doc 8.4).

Nothing here comes from client input: user_id comes from the session (or MCP token) and
tenant_id from the session's active tenant (or the token). Roles are never cached.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Membership, PermissionState, Role, TempGrant, UserRole

SYSTEM_ROLES = ("owner", "admin", "auditor")


@dataclass(frozen=True)
class RequestContext:
    user_id: UUID
    tenant_id: UUID
    membership_status: str  # pending | active
    role_keys: frozenset[str]
    role_ids: frozenset[UUID]
    # Only business roles grant content access; system roles grant configuration (4.1).
    business_role_ids: frozenset[UUID]
    temp_grant_container_ids: frozenset[UUID]
    permission_version: int

    @property
    def is_active(self) -> bool:
        return self.membership_status == "active"

    @property
    def is_admin(self) -> bool:
        return bool(self.role_keys & {"owner", "admin"})

    @property
    def business_role_keys(self) -> frozenset[str]:
        return self.role_keys - set(SYSTEM_ROLES)


async def load_context(s: AsyncSession, tenant_id: UUID, user_id: UUID) -> RequestContext | None:
    """`s` must already be scoped to `tenant_id`. Returns None for non-members/removed."""
    status = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if status not in ("pending", "active"):
        return None

    roles: list[tuple[UUID, str, bool]] = []
    grants: list[UUID] = []
    if status == "active":
        roles = (
            await s.execute(
                select(Role.id, Role.key, Role.is_system)
                .join(
                    UserRole, (UserRole.role_id == Role.id) & (UserRole.tenant_id == Role.tenant_id)
                )
                .where(
                    UserRole.user_id == user_id,
                    or_(UserRole.expires_at.is_(None), UserRole.expires_at > func.now()),
                )
            )
        ).all()
        grants = (
            await s.scalars(
                select(TempGrant.container_id).where(
                    TempGrant.user_id == user_id, TempGrant.expires_at > func.now()
                )
            )
        ).all()

    version = await s.scalar(select(PermissionState.version))
    return RequestContext(
        user_id=user_id,
        tenant_id=tenant_id,
        membership_status=status,
        role_keys=frozenset(k for _, k, _ in roles),
        role_ids=frozenset(i for i, _, _ in roles),
        business_role_ids=frozenset(i for i, _, system in roles if not system),
        temp_grant_container_ids=frozenset(grants),
        permission_version=version,
    )
