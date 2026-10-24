"""Who may approve (design doc 12.3): topic → container → department → admin.
Requesters never approve their own requests."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import (
    Container,
    Manager,
    MemberProfile,
    Membership,
    Role,
    TopicOwner,
    UserRole,
)


async def _managers(s: AsyncSession, scope_type: str, scope_id: str | None) -> set[uuid.UUID]:
    if not scope_id:
        return set()
    return set(
        await s.scalars(
            select(Manager.manager_user_id)
            .join(
                Membership,
                (Membership.user_id == Manager.manager_user_id)
                & (Membership.tenant_id == Manager.tenant_id),
            )
            .where(
                Manager.scope_type == scope_type,
                Manager.scope_id == scope_id,
                Membership.status == "active",
            )
        )
    )


async def admins(s: AsyncSession) -> set[uuid.UUID]:
    return set(
        await s.scalars(
            select(UserRole.user_id)
            .join(Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id))
            .join(
                Membership,
                (Membership.user_id == UserRole.user_id)
                & (Membership.tenant_id == UserRole.tenant_id),
            )
            .where(Role.key.in_(("admin", "owner")), Membership.status == "active")
        )
    )


async def department_of(s: AsyncSession, user_id: uuid.UUID) -> str | None:
    return await s.scalar(select(MemberProfile.department).where(MemberProfile.user_id == user_id))


async def for_access(
    s: AsyncSession, topic_key: str, container_id: uuid.UUID | None, requester_id: uuid.UUID
) -> set[uuid.UUID]:
    """Approvers for an access request; the first non-empty level wins (12.3)."""
    for scope_type, scope_id in (
        ("topic", topic_key),
        ("container", str(container_id) if container_id else None),
        ("department", await department_of(s, requester_id)),
    ):
        found = await _managers(s, scope_type, scope_id) - {requester_id}
        if found:
            return found
    return await admins(s) - {requester_id}


async def for_draft(
    s: AsyncSession, topic_key: str | None, container_id: uuid.UUID
) -> set[uuid.UUID]:
    """Approvers for a document change: the topic owner, else the document's container owner,
    else managers of that topic/container, else admins (12.2: "antrean approval pemilik topik")."""
    if topic_key:
        owner = await s.scalar(
            select(TopicOwner.owner_user_id).where(TopicOwner.topic_key == topic_key)
        )
        if owner:
            return {owner}
    owner = await s.scalar(select(Container.owner_user_id).where(Container.id == container_id))
    if owner:
        return {owner}
    for scope_type, scope_id in (("topic", topic_key), ("container", str(container_id))):
        found = await _managers(s, scope_type, scope_id)
        if found:
            return found
    return await admins(s)
