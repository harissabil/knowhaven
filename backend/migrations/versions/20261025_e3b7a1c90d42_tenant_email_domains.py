"""tenant email domains: the company's own mail domains (work addresses aren't personal data)

Revision ID: e3b7a1c90d42
Revises: 5a8d2c7e19f0
Create Date: 2026-10-25 20:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3b7a1c90d42"
down_revision: str | Sequence[str] | None = "5a8d2c7e19f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_domains TEXT[] NOT NULL DEFAULT '{}'"
    )


def downgrade() -> None:
    op.drop_column("tenants", "email_domains")
