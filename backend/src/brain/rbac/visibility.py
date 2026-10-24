"""visible(item, user), design doc 8.4, as one SQL expression reused by every query.

    item.deleted_at IS NULL
    AND container.mapped
    AND NOT deny_override(item, roles)                       -- deny always wins
    AND ( container_acl(container) ∩ roles ≠ ∅
          OR active temp_grant(user, container)
          OR allow_override(item, roles) )

`roles` are the user's *business* roles only (system roles grant configuration, not content).
Tier (hidden/gated/open) does not widen visibility; it only controls what a user *without*
access is told (8.2). RLS already restricts everything to the active tenant.
"""

from collections.abc import Iterable

from sqlalchemy import ColumnElement, and_, exists, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from brain.db.models import Container, ContainerAcl, ItemAclOverride, SourceItem
from brain.rbac.context import RequestContext


def _override(effect: str, role_ids: list) -> ColumnElement[bool]:
    if not role_ids:
        return false()
    o = aliased(ItemAclOverride)
    return (
        exists()
        .where(
            o.tenant_id == SourceItem.tenant_id,
            o.item_id == SourceItem.id,
            o.effect == effect,
            o.role_id.in_(role_ids),
        )
        .correlate(SourceItem)
    )


def visible_item_clause(ctx: RequestContext) -> ColumnElement[bool]:
    """WHERE clause over `SourceItem` (correlated; no join needed in the caller). Uses aliases and
    explicit correlation so it composes into queries that also join containers/overrides."""
    roles = sorted(ctx.business_role_ids)
    grants = sorted(ctx.temp_grant_container_ids)
    c, acl_t = aliased(Container), aliased(ContainerAcl)
    mapped = (
        exists()
        .where(
            c.tenant_id == SourceItem.tenant_id, c.id == SourceItem.container_id, c.mapped.is_(True)
        )
        .correlate(SourceItem)
    )
    acl = (
        exists()
        .where(
            acl_t.tenant_id == SourceItem.tenant_id,
            acl_t.container_id == SourceItem.container_id,
            acl_t.role_id.in_(roles),
        )
        .correlate(SourceItem)
        if roles
        else false()
    )
    grant = SourceItem.container_id.in_(grants) if grants else false()
    return and_(
        SourceItem.deleted_at.is_(None),
        mapped,
        ~_override("deny", roles),
        or_(acl, grant, _override("allow", roles)),
    )


def visible_container_clause(ctx: RequestContext) -> ColumnElement[bool]:
    """Containers the user can see as a whole (ignores per-item overrides)."""
    roles = sorted(ctx.business_role_ids)
    grants = sorted(ctx.temp_grant_container_ids)
    acl = (
        exists().where(
            ContainerAcl.tenant_id == Container.tenant_id,
            ContainerAcl.container_id == Container.id,
            ContainerAcl.role_id.in_(roles),
        )
        if roles
        else false()
    )
    return and_(
        Container.mapped.is_(True), or_(acl, Container.id.in_(grants) if grants else false())
    )


async def filter_visible_ids(
    s: AsyncSession, ctx: RequestContext, item_ids: Iterable[str]
) -> set[str]:
    """Subset of `item_ids` the user may see. Unknown and forbidden IDs are both just absent."""
    ids = sorted(set(item_ids))
    if not ids:
        return set()
    rows = await s.scalars(
        select(SourceItem.id).where(SourceItem.id.in_(ids), visible_item_clause(ctx))
    )
    return set(rows)
