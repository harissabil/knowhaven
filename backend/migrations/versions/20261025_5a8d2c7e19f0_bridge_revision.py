"""bridge revision 5a8d2c7e19f0

Revision ID: 5a8d2c7e19f0
Revises: 7c2e91a4d5b3
Create Date: 2026-10-25 02:50:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5a8d2c7e19f0"
down_revision: str | Sequence[str] | None = "7c2e91a4d5b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS profile TEXT")


def downgrade() -> None:
    pass
