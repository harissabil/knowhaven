"""Tenant lifecycle and onboarding (design doc 4.4, 6.3).

All functions take a session already scoped to the tenant they act on (tenant_session),
except the pre-tenant resolvers, which go through the SECURITY DEFINER lookup functions.
"""

import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import (
    Invite,
    McpToken,
    MemberProfile,
    Membership,
    PermissionState,
    PiiPermission,
    Role,
    TempGrant,
    Tenant,
    UserRole,
)
from brain.rbac.state import bump_permission_version
from brain.security import encrypt, new_join_code, new_token, normalize_join_code, sha256

# (key, name, is_system). Business roles are templates the admin can edit later (4.1).
ROLE_TEMPLATES = [
    ("owner", "Owner", True),
    ("admin", "Admin", True),
    ("auditor", "Auditor", True),
    ("new_hire", "Karyawan Baru", False),
    ("staff", "Staf", False),
    ("ops", "Operasional", False),
    ("hr", "HR", False),
    ("project_mgr", "Project Manager", False),
    ("finance", "Keuangan", False),
    ("direksi", "Direksi", False),
]
# Default PII template (4.3): only HR sees unmasked personal data.
PII_TEMPLATE = {"hr": ["nik", "phone", "email", "npwp", "bank_account"]}


class TenancyError(Exception):
    """Carries a stable error code for the API layer."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Resolved:
    tenant_id: uuid.UUID
    tenant_name: str


def slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "company"
    # Random suffix: slugs are globally unique, but tenants can't see each other under RLS.
    return f"{base}-{secrets.token_hex(2)}"


async def _set_join_code(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    code = new_join_code()
    await s.execute(
        update(Tenant)
        .where(Tenant.id == tenant_id)
        .values(join_code_hash=sha256(normalize_join_code(code)), join_code_encrypted=encrypt(code))
    )
    return code


async def create_tenant(
    s: AsyncSession, tenant_id: uuid.UUID, name: str, creator_id: uuid.UUID
) -> str:
    """Creates tenant + roles + creator as Owner+Admin. Returns the join code."""
    s.add(Tenant(id=tenant_id, name=name.strip(), slug=slugify(name), created_by=creator_id))
    await s.flush()
    s.add(PermissionState(tenant_id=tenant_id))
    s.add(Membership(tenant_id=tenant_id, user_id=creator_id, status="active"))
    await s.flush()  # composite FKs aren't ORM relationships, so order inserts explicitly
    s.add(MemberProfile(tenant_id=tenant_id, user_id=creator_id))
    roles = {
        key: Role(tenant_id=tenant_id, key=key, name=n, is_system=sys)
        for key, n, sys in ROLE_TEMPLATES
    }
    s.add_all(roles.values())
    await s.flush()
    for key in ("owner", "admin"):
        s.add(
            UserRole(
                tenant_id=tenant_id,
                user_id=creator_id,
                role_id=roles[key].id,
                granted_by=creator_id,
            )
        )
    for role_key, pii_types in PII_TEMPLATE.items():
        s.add_all(
            PiiPermission(tenant_id=tenant_id, role_id=roles[role_key].id, pii_type=t)
            for t in pii_types
        )
    await s.flush()
    return await _set_join_code(s, tenant_id)


async def rotate_join_code(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    return await _set_join_code(s, tenant_id)


async def create_invite(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    role_id: uuid.UUID,
    created_by: uuid.UUID,
    expires_in: timedelta,
    max_uses: int,
) -> tuple[Invite, str]:
    """Returns the invite and the raw token (shown once; only its hash is stored)."""
    role = await s.scalar(select(Role).where(Role.id == role_id))
    if role is None:
        raise TenancyError("role_not_found")
    if role.is_system:
        # Invites grant a minimal starting role; system roles are assigned explicitly (6.3).
        raise TenancyError("invite_role_must_be_business")
    token = new_token()
    invite = Invite(
        tenant_id=tenant_id,
        token_hash=sha256(token),
        default_role_id=role_id,
        expires_at=datetime.now(UTC) + expires_in,
        max_uses=max_uses,
        created_by=created_by,
    )
    s.add(invite)
    await s.flush()
    return invite, token


async def resolve_invite(s: AsyncSession, token: str) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """(invite_id, tenant_id, tenant_name) for a usable invite, else None. Global session."""
    row = (
        await s.execute(text("SELECT * FROM resolve_invite(:h)"), {"h": sha256(token)})
    ).one_or_none()
    return (row.invite_id, row.tenant_id, row.tenant_name) if row else None


async def resolve_join_code(s: AsyncSession, code: str) -> Resolved | None:
    row = (
        await s.execute(
            text("SELECT * FROM resolve_join_code(:h)"), {"h": sha256(normalize_join_code(code))}
        )
    ).one_or_none()
    return Resolved(row.tenant_id, row.tenant_name) if row else None


async def list_my_memberships(s: AsyncSession, user_id: uuid.UUID) -> list:
    return (await s.execute(text("SELECT * FROM list_my_memberships(:u)"), {"u": user_id})).all()


async def accept_invite(
    s: AsyncSession, tenant_id: uuid.UUID, invite_id: uuid.UUID, user_id: uuid.UUID
) -> str:
    """Joins the tenant as an active member with the invite's role. Returns membership status."""
    existing = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if existing == "active":
        return "active"  # already a member: don't consume a use
    role_id = await s.scalar(
        update(Invite)
        .where(
            Invite.id == invite_id,
            Invite.revoked_at.is_(None),
            Invite.expires_at > func.now(),
            Invite.used_count < Invite.max_uses,
        )
        .values(used_count=Invite.used_count + 1)
        .returning(Invite.default_role_id)
    )
    if role_id is None:
        raise TenancyError("invite_invalid")
    await _upsert_membership(s, tenant_id, user_id, "active")
    await s.execute(
        insert(UserRole)
        .values(tenant_id=tenant_id, user_id=user_id, role_id=role_id)
        .on_conflict_do_nothing()
    )
    await bump_permission_version(s, tenant_id)
    return "active"


async def request_join(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """Join by company code: pending with zero data access until an admin approves (T30)."""
    existing = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if existing in ("active", "pending"):
        return existing
    await _upsert_membership(s, tenant_id, user_id, "pending")
    return "pending"


async def _upsert_membership(
    s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, status: str
) -> None:
    await s.execute(
        insert(Membership)
        .values(tenant_id=tenant_id, user_id=user_id, status=status)
        .on_conflict_do_update(
            index_elements=["tenant_id", "user_id"],
            set_={"status": status, "joined_at": func.now(), "removed_at": None},
        )
    )
    await s.execute(
        insert(MemberProfile)
        .values(tenant_id=tenant_id, user_id=user_id)
        .on_conflict_do_update(index_elements=["tenant_id", "user_id"], set_={"is_active": True})
    )


async def approve_member(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    role_ids: list[uuid.UUID],
    approved_by: uuid.UUID,
) -> None:
    status = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if status != "pending":
        raise TenancyError("not_pending")
    roles = (await s.scalars(select(Role).where(Role.id.in_(role_ids)))).all()
    if not role_ids or len(roles) != len(set(role_ids)):
        raise TenancyError("role_not_found")
    await s.execute(update(Membership).where(Membership.user_id == user_id).values(status="active"))
    for role in roles:
        await s.execute(
            insert(UserRole)
            .values(tenant_id=tenant_id, user_id=user_id, role_id=role.id, granted_by=approved_by)
            .on_conflict_do_nothing()
        )
    await bump_permission_version(s, tenant_id)


async def reject_member(s: AsyncSession, user_id: uuid.UUID) -> None:
    result = await s.execute(
        update(Membership)
        .where(Membership.user_id == user_id, Membership.status == "pending")
        .values(status="removed", removed_at=func.now())
    )
    if result.rowcount == 0:
        raise TenancyError("not_pending")


async def _owner_count(s: AsyncSession) -> int:
    return await s.scalar(
        select(func.count())
        .select_from(UserRole)
        .join(Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id))
        .join(
            Membership,
            (Membership.user_id == UserRole.user_id) & (Membership.tenant_id == UserRole.tenant_id),
        )
        .where(Role.key == "owner", Membership.status == "active")
    )


async def remove_member(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Removed (or left): tokens revoked, temp grants and roles dropped, version bumped (6.3)."""
    status = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if status is None or status == "removed":
        raise TenancyError("member_not_found")
    is_owner = await s.scalar(
        select(func.count())
        .select_from(UserRole)
        .join(Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id))
        .where(UserRole.user_id == user_id, Role.key == "owner")
    )
    if is_owner and await _owner_count(s) <= 1:
        raise TenancyError("last_owner")
    await s.execute(
        update(Membership)
        .where(Membership.user_id == user_id)
        .values(status="removed", removed_at=func.now())
    )
    await s.execute(
        update(MemberProfile).where(MemberProfile.user_id == user_id).values(is_active=False)
    )
    await s.execute(
        update(McpToken)
        .where(McpToken.user_id == user_id, McpToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    await s.execute(delete(TempGrant).where(TempGrant.user_id == user_id))
    await s.execute(delete(UserRole).where(UserRole.user_id == user_id))
    await bump_permission_version(s, tenant_id)
