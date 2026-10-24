"""Owner/Admin RBAC configuration (design doc 8, 14.1): roles, member roles and profiles,
containers (tier, ACL, mapping), item overrides, approvers, topic owners, PII permissions.

Every mutation goes through `_changed()`: permission version bump + audit row, in the same
transaction as the change.
"""

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from brain.api.deps import Admin
from brain.audit import log as audit
from brain.db.models import (
    Container,
    ContainerAcl,
    ItemAclOverride,
    Manager,
    MemberProfile,
    Membership,
    PiiPermission,
    Role,
    SourceItem,
    TopicOwner,
    UserRole,
)
from brain.db.session import tenant_session
from brain.rbac.context import RequestContext
from brain.rbac.state import bump_permission_version

router = APIRouter(prefix="/admin", tags=["admin-rbac"])

ROLE_KEY = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
TIERS = ("hidden", "gated", "open")
AUTHORITIES = ("official_doc", "official_announcement", "team_discussion", "personal")
PII_TYPES = ("nik", "phone", "email", "npwp", "bank_account")
ADMIN_CREATABLE_SOURCES = ("upload_folder", "whatsapp_group")


def _err(code: int, detail: str) -> HTTPException:
    return HTTPException(code, detail)


async def _changed(s: AsyncSession, ctx: RequestContext, action: str, **details) -> int:
    version = await bump_permission_version(s, ctx.tenant_id)
    await audit.admin_event(s, ctx, action, permission_version=version, **details)
    return version


async def _business_roles(s: AsyncSession, role_ids: list[uuid.UUID]) -> list[Role]:
    roles = (await s.scalars(select(Role).where(Role.id.in_(role_ids)))).all() if role_ids else []
    if len(roles) != len(set(role_ids)):
        raise _err(status.HTTP_404_NOT_FOUND, "role_not_found")
    if any(r.is_system for r in roles):
        # Content access is only ever granted through business roles (4.1).
        raise _err(status.HTTP_422_UNPROCESSABLE_CONTENT, "system_role_not_allowed")
    return roles


async def _require_active_member(s: AsyncSession, user_id: uuid.UUID) -> None:
    st = await s.scalar(select(Membership.status).where(Membership.user_id == user_id))
    if st != "active":
        raise _err(status.HTTP_404_NOT_FOUND, "member_not_found")


async def _container(s: AsyncSession, container_id: uuid.UUID) -> Container:
    c = await s.scalar(select(Container).where(Container.id == container_id))
    if c is None:
        raise _err(status.HTTP_404_NOT_FOUND, "container_not_found")
    return c


class VersionOut(BaseModel):
    permission_version: int


# --- roles ------------------------------------------------------------------------------


class RoleIn(BaseModel):
    key: str
    name: str = Field(min_length=1, max_length=80)

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not ROLE_KEY.match(v):
            raise ValueError("lowercase letters, digits, underscore; 2-31 chars")
        return v


class RoleRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RoleCreated(BaseModel):
    id: str
    permission_version: int


@router.post("/roles", status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleIn, ctx: Admin) -> RoleCreated:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            role = Role(tenant_id=ctx.tenant_id, key=body.key, name=body.name)
            s.add(role)
            await s.flush()
            v = await _changed(s, ctx, "role.create", role_id=role.id, key=body.key)
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "role_key_taken") from None
    return RoleCreated(id=str(role.id), permission_version=v)


@router.patch("/roles/{role_id}")
async def rename_role(role_id: uuid.UUID, body: RoleRename, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        role = await s.scalar(select(Role).where(Role.id == role_id))
        if role is None:
            raise _err(status.HTTP_404_NOT_FOUND, "role_not_found")
        if role.is_system:
            raise _err(status.HTTP_409_CONFLICT, "system_role_immutable")
        role.name = body.name
        v = await _changed(s, ctx, "role.rename", role_id=role_id, name=body.name)
    return VersionOut(permission_version=v)


@router.delete("/roles/{role_id}")
async def delete_role(role_id: uuid.UUID, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        role = await s.scalar(select(Role).where(Role.id == role_id))
        if role is None:
            raise _err(status.HTTP_404_NOT_FOUND, "role_not_found")
        if role.is_system:
            raise _err(status.HTTP_409_CONFLICT, "system_role_immutable")
        await s.delete(role)  # cascades user_roles, container_acl, pii, overrides, invites
        v = await _changed(s, ctx, "role.delete", role_id=role_id, key=role.key)
    return VersionOut(permission_version=v)


# --- member roles + profile ---------------------------------------------------------------


class RoleGrant(BaseModel):
    role_id: uuid.UUID
    expires_at: datetime | None = None


class MemberRolesIn(BaseModel):
    roles: list[RoleGrant]


class ProfileIn(BaseModel):
    department: str | None = None
    title: str | None = None
    branch_office: str | None = None
    slack_user_id: str | None = None
    display_aliases: list[str] | None = None


@router.put("/members/{user_id}/roles")
async def set_member_roles(user_id: uuid.UUID, body: MemberRolesIn, ctx: Admin) -> VersionOut:
    """Replace a member's role set. Owner role changes require an owner; one owner must remain."""
    wanted = {g.role_id: g.expires_at for g in body.roles}
    async with tenant_session(ctx.tenant_id) as s:
        await _require_active_member(s, user_id)
        roles = {r.id: r for r in await s.scalars(select(Role).where(Role.id.in_(list(wanted))))}
        if len(roles) != len(wanted):
            raise _err(status.HTTP_404_NOT_FOUND, "role_not_found")
        current = {
            r.id: r
            for r in await s.scalars(
                select(Role)
                .join(
                    UserRole, (UserRole.role_id == Role.id) & (UserRole.tenant_id == Role.tenant_id)
                )
                .where(UserRole.user_id == user_id)
            )
        }
        owner_touched = any(r.key == "owner" for r in (*roles.values(), *current.values())) and (
            {i for i, r in roles.items() if r.key == "owner"}
            != {i for i, r in current.items() if r.key == "owner"}
        )
        if owner_touched and "owner" not in ctx.role_keys:
            raise _err(status.HTTP_403_FORBIDDEN, "owner_required")
        await s.execute(delete(UserRole).where(UserRole.user_id == user_id))
        for role_id, expires_at in wanted.items():
            s.add(
                UserRole(
                    tenant_id=ctx.tenant_id,
                    user_id=user_id,
                    role_id=role_id,
                    granted_by=ctx.user_id,
                    expires_at=expires_at,
                )
            )
        await s.flush()
        owners = await s.scalar(
            select(func.count())
            .select_from(UserRole)
            .join(Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id))
            .where(Role.key == "owner")
        )
        if owners == 0:
            raise _err(status.HTTP_409_CONFLICT, "last_owner")
        added_business = sorted(
            r.key for i, r in roles.items() if not r.is_system and i not in current
        )
        v = await _changed(
            s,
            ctx,
            "member.roles.set",
            user_id=user_id,
            before=sorted(r.key for r in current.values()),
            after=sorted(r.key for r in roles.values()),
            expires={roles[i].key: e for i, e in wanted.items() if e},
            # Separation of duties (4.1): an admin giving *themselves* content access.
            self_grant=user_id == ctx.user_id and bool(added_business),
        )
    return VersionOut(permission_version=v)


@router.patch("/members/{user_id}/profile")
async def update_profile(user_id: uuid.UUID, body: ProfileIn, ctx: Admin) -> VersionOut:
    changes = body.model_dump(exclude_unset=True)
    try:
        async with tenant_session(ctx.tenant_id) as s:
            await _require_active_member(s, user_id)
            await s.execute(
                update(MemberProfile).where(MemberProfile.user_id == user_id).values(**changes)
            )
            v = await _changed(
                s, ctx, "member.profile.update", user_id=user_id, fields=sorted(changes)
            )
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "slack_user_id_taken") from None
    return VersionOut(permission_version=v)


# --- containers -----------------------------------------------------------------------------


class ContainerOut(BaseModel):
    id: str
    source: str
    external_id: str
    name: str
    tier: str
    mapped: bool
    role_ids: list[str]
    owner_user_id: str | None
    authority_default: str | None
    item_count: int
    created_at: datetime


class ContainerCreate(BaseModel):
    source: str
    name: str = Field(min_length=1, max_length=120)

    @field_validator("source")
    @classmethod
    def _src(cls, v: str) -> str:
        if v not in ADMIN_CREATABLE_SOURCES:
            raise ValueError(f"one of {ADMIN_CREATABLE_SOURCES}; others come from integrations")
        return v


class ContainerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    tier: str | None = None
    mapped: bool | None = None
    role_ids: list[uuid.UUID] | None = None
    owner_user_id: uuid.UUID | None = None
    authority_default: str | None = None

    @field_validator("tier")
    @classmethod
    def _tier(cls, v):
        if v is not None and v not in TIERS:
            raise ValueError(f"one of {TIERS}")
        return v

    @field_validator("authority_default")
    @classmethod
    def _auth(cls, v):
        if v is not None and v not in AUTHORITIES:
            raise ValueError(f"one of {AUTHORITIES}")
        return v


@router.get("/containers")
async def list_containers(ctx: Admin, unmapped_only: bool = False) -> list[ContainerOut]:
    async with tenant_session(ctx.tenant_id) as s:
        q = select(Container).order_by(Container.mapped, Container.source, Container.name)
        if unmapped_only:
            q = q.where(Container.mapped.is_(False))
        containers = (await s.scalars(q)).all()
        acl: dict[uuid.UUID, list[str]] = {}
        for cid, rid in await s.execute(select(ContainerAcl.container_id, ContainerAcl.role_id)):
            acl.setdefault(cid, []).append(str(rid))
        counts = dict(
            (
                await s.execute(
                    select(SourceItem.container_id, func.count())
                    .where(SourceItem.deleted_at.is_(None))
                    .group_by(SourceItem.container_id)
                )
            ).all()
        )
    return [
        ContainerOut(
            id=str(c.id),
            source=c.source,
            external_id=c.external_id,
            name=c.name,
            tier=c.tier,
            mapped=c.mapped,
            role_ids=sorted(acl.get(c.id, [])),
            owner_user_id=str(c.owner_user_id) if c.owner_user_id else None,
            authority_default=c.authority_default,
            item_count=counts.get(c.id, 0),
            created_at=c.created_at,
        )
        for c in containers
    ]


@router.post("/containers", status_code=status.HTTP_201_CREATED)
async def create_container(body: ContainerCreate, ctx: Admin) -> RoleCreated:
    """Upload folders / WhatsApp groups. Created hidden + unmapped (default-deny, 8.3)."""
    async with tenant_session(ctx.tenant_id) as s:
        c = Container(
            tenant_id=ctx.tenant_id,
            source=body.source,
            external_id=uuid.uuid4().hex,
            name=body.name,
        )
        s.add(c)
        await s.flush()
        v = await _changed(s, ctx, "container.create", container_id=c.id, source=body.source)
    return RoleCreated(id=str(c.id), permission_version=v)


@router.patch("/containers/{container_id}")
async def update_container(container_id: uuid.UUID, body: ContainerPatch, ctx: Admin) -> VersionOut:
    changes = body.model_dump(exclude_unset=True)
    async with tenant_session(ctx.tenant_id) as s:
        c = await _container(s, container_id)
        role_ids = changes.pop("role_ids", None)
        if "owner_user_id" in changes and changes["owner_user_id"] is not None:
            await _require_active_member(s, changes["owner_user_id"])
        for k, val in changes.items():
            setattr(c, k, val)
        if role_ids is not None:
            await _business_roles(s, role_ids)
            await s.execute(delete(ContainerAcl).where(ContainerAcl.container_id == container_id))
            s.add_all(
                ContainerAcl(tenant_id=ctx.tenant_id, container_id=container_id, role_id=r)
                for r in set(role_ids)
            )
        await s.flush()
        v = await _changed(
            s,
            ctx,
            "container.update",
            container_id=container_id,
            changes=changes,
            role_ids=sorted(role_ids) if role_ids is not None else None,
        )
    return VersionOut(permission_version=v)


# --- item overrides (API only for now, 25.3 Q6) --------------------------------------------


class OverrideItem(BaseModel):
    role_id: uuid.UUID
    effect: str

    @field_validator("effect")
    @classmethod
    def _eff(cls, v):
        if v not in ("allow", "deny"):
            raise ValueError("allow or deny")
        return v


class OverridesIn(BaseModel):
    overrides: list[OverrideItem]


@router.get("/items/{item_id}/overrides")
async def get_overrides(item_id: str, ctx: Admin) -> list[OverrideItem]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await s.scalars(select(ItemAclOverride).where(ItemAclOverride.item_id == item_id))
        return [OverrideItem(role_id=o.role_id, effect=o.effect) for o in rows]


@router.put("/items/{item_id}/overrides")
async def set_overrides(item_id: str, body: OverridesIn, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        if await s.scalar(select(SourceItem.id).where(SourceItem.id == item_id)) is None:
            raise _err(status.HTTP_404_NOT_FOUND, "item_not_found")
        await _business_roles(s, [o.role_id for o in body.overrides])
        await s.execute(delete(ItemAclOverride).where(ItemAclOverride.item_id == item_id))
        s.add_all(
            ItemAclOverride(
                tenant_id=ctx.tenant_id, item_id=item_id, role_id=o.role_id, effect=o.effect
            )
            for o in body.overrides
        )
        v = await _changed(
            s,
            ctx,
            "item.overrides.set",
            item_id=item_id,
            overrides=[o.model_dump() for o in body.overrides],
        )
    return VersionOut(permission_version=v)


# --- managers (approvers) -------------------------------------------------------------------


class ManagerIn(BaseModel):
    scope_type: str
    scope_id: str = Field(min_length=1, max_length=120)
    manager_user_id: uuid.UUID

    @field_validator("scope_type")
    @classmethod
    def _scope(cls, v):
        if v not in ("department", "container", "topic"):
            raise ValueError("department, container or topic")
        return v


class ManagerOut(ManagerIn):
    id: str


@router.get("/managers")
async def list_managers(ctx: Admin) -> list[ManagerOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await s.scalars(select(Manager).order_by(Manager.scope_type, Manager.scope_id))
        return [
            ManagerOut(
                id=str(m.id),
                scope_type=m.scope_type,
                scope_id=m.scope_id,
                manager_user_id=m.manager_user_id,
            )
            for m in rows
        ]


@router.post("/managers", status_code=status.HTTP_201_CREATED)
async def add_manager(body: ManagerIn, ctx: Admin) -> RoleCreated:
    try:
        async with tenant_session(ctx.tenant_id) as s:
            await _require_active_member(s, body.manager_user_id)
            if body.scope_type == "container":
                await _container(s, uuid.UUID(body.scope_id))
            m = Manager(tenant_id=ctx.tenant_id, **body.model_dump())
            s.add(m)
            await s.flush()
            v = await _changed(s, ctx, "manager.add", **body.model_dump())
    except IntegrityError:
        raise _err(status.HTTP_409_CONFLICT, "manager_exists") from None
    except ValueError:
        raise _err(status.HTTP_422_UNPROCESSABLE_CONTENT, "container_scope_must_be_uuid") from None
    return RoleCreated(id=str(m.id), permission_version=v)


@router.delete("/managers/{manager_id}")
async def remove_manager(manager_id: uuid.UUID, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        result = await s.execute(delete(Manager).where(Manager.id == manager_id))
        if result.rowcount == 0:
            raise _err(status.HTTP_404_NOT_FOUND, "manager_not_found")
        v = await _changed(s, ctx, "manager.remove", manager_id=manager_id)
    return VersionOut(permission_version=v)


# --- topic owners -----------------------------------------------------------------------------


class TopicIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    aliases: list[str] = []
    owner_user_id: uuid.UUID | None = None
    fallback_contact: str = Field(min_length=1, max_length=200)
    tier: str = "open"
    container_id: uuid.UUID | None = None

    @field_validator("tier")
    @classmethod
    def _tier(cls, v):
        if v not in TIERS:
            raise ValueError(f"one of {TIERS}")
        return v


class TopicOut(TopicIn):
    topic_key: str


@router.get("/topics")
async def list_topics(ctx: Admin) -> list[TopicOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await s.scalars(select(TopicOwner).order_by(TopicOwner.topic_key))
        return [
            TopicOut(
                topic_key=t.topic_key,
                display_name=t.display_name,
                aliases=t.aliases,
                owner_user_id=t.owner_user_id,
                fallback_contact=t.fallback_contact,
                tier=t.tier,
                container_id=t.container_id,
            )
            for t in rows
        ]


@router.put("/topics/{topic_key}")
async def upsert_topic(topic_key: str, body: TopicIn, ctx: Admin) -> VersionOut:
    if not ROLE_KEY.match(topic_key):
        raise _err(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_topic_key")
    if body.tier == "gated" and body.container_id is None:
        # A gated topic must say which container an approved request opens (12.1).
        raise _err(status.HTTP_422_UNPROCESSABLE_CONTENT, "gated_topic_needs_container")
    async with tenant_session(ctx.tenant_id) as s:
        if body.owner_user_id:
            await _require_active_member(s, body.owner_user_id)
        if body.container_id:
            await _container(s, body.container_id)
        existing = await s.scalar(select(TopicOwner).where(TopicOwner.topic_key == topic_key))
        if existing is None:
            s.add(TopicOwner(tenant_id=ctx.tenant_id, topic_key=topic_key, **body.model_dump()))
        else:
            for k, val in body.model_dump().items():
                setattr(existing, k, val)
        await s.flush()
        v = await _changed(s, ctx, "topic.upsert", topic_key=topic_key, tier=body.tier)
    return VersionOut(permission_version=v)


@router.delete("/topics/{topic_key}")
async def delete_topic(topic_key: str, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        result = await s.execute(delete(TopicOwner).where(TopicOwner.topic_key == topic_key))
        if result.rowcount == 0:
            raise _err(status.HTTP_404_NOT_FOUND, "topic_not_found")
        v = await _changed(s, ctx, "topic.delete", topic_key=topic_key)
    return VersionOut(permission_version=v)


# --- PII permissions --------------------------------------------------------------------------


class PiiIn(BaseModel):
    pii_types: list[str]

    @field_validator("pii_types")
    @classmethod
    def _types(cls, v):
        bad = set(v) - set(PII_TYPES)
        if bad:
            raise ValueError(f"unknown: {sorted(bad)}; allowed {PII_TYPES}")
        return sorted(set(v))


@router.get("/pii")
async def get_pii(ctx: Admin) -> dict[str, list[str]]:
    """{role_id: [pii_type, ...]}"""
    async with tenant_session(ctx.tenant_id) as s:
        out: dict[str, list[str]] = {}
        for rid, t in await s.execute(select(PiiPermission.role_id, PiiPermission.pii_type)):
            out.setdefault(str(rid), []).append(t)
    return {k: sorted(v) for k, v in out.items()}


@router.put("/pii/{role_id}")
async def set_pii(role_id: uuid.UUID, body: PiiIn, ctx: Admin) -> VersionOut:
    async with tenant_session(ctx.tenant_id) as s:
        await _business_roles(s, [role_id])
        await s.execute(delete(PiiPermission).where(PiiPermission.role_id == role_id))
        s.add_all(
            PiiPermission(tenant_id=ctx.tenant_id, role_id=role_id, pii_type=t)
            for t in body.pii_types
        )
        v = await _changed(s, ctx, "pii.set", role_id=role_id, pii_types=body.pii_types)
    return VersionOut(permission_version=v)
