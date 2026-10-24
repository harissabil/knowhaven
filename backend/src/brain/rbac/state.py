from uuid import UUID

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import PermissionState


async def bump_permission_version(s: AsyncSession, tenant_id: UUID) -> int:
    """Call in the same transaction as every permission change (design doc 8.5)."""
    return await s.scalar(
        update(PermissionState)
        .where(PermissionState.tenant_id == tenant_id)
        .values(version=PermissionState.version + 1, updated_at=func.now())
        .returning(PermissionState.version)
    )
