"""Add avatar column to users table.

Revision ID: 004
Revises: 003
Create Date: 2026-09-16
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar")
