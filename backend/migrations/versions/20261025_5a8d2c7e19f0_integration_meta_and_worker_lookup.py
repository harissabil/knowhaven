"""integration metadata + worker lookup

Non-secret integration state (workspace name, counts, last error) lives in `meta`, so the admin UI
never needs the encrypted credentials. `list_active_integrations()` lets the sync worker find
integrations across tenants before it knows which tenant to scope to (like resolve_integration).

Revision ID: 5a8d2c7e19f0
Revises: 7c2e91a4d5b3
Create Date: 2026-10-25 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "5a8d2c7e19f0"
down_revision: str | Sequence[str] | None = "7c2e91a4d5b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "brain_app"
SIGNATURE = "list_active_integrations(text[])"


def upgrade() -> None:
    op.add_column(
        "integrations",
        sa.Column("meta", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column("integrations", sa.Column("last_error", sa.Text(), nullable=True))
    op.execute(
        """
CREATE FUNCTION list_active_integrations(p_types text[])
RETURNS TABLE (integration_id uuid, tenant_id uuid, type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, i.type FROM integrations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.type = ANY(p_types) AND i.status <> 'disconnected' AND t.status = 'active'
  ORDER BY i.last_sync_at NULLS FIRST
$$"""
    )
    op.execute(f"REVOKE ALL ON FUNCTION {SIGNATURE} FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION {SIGNATURE} TO {APP_ROLE}")


def downgrade() -> None:
    op.execute(f"DROP FUNCTION IF EXISTS {SIGNATURE}")
    op.drop_column("integrations", "last_error")
    op.drop_column("integrations", "meta")
