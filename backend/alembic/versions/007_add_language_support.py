"""Add language support columns for multilingual platform.

Revision ID: 007
Revises: 006
Create Date: 2026-09-17
"""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("preferred_language", sa.String(), nullable=True, server_default="en"),
    )
    op.add_column("atomic_claims", sa.Column("original_language", sa.String(), nullable=True))
    op.add_column("atomic_claims", sa.Column("original_content", sa.Text(), nullable=True))
    op.add_column("glossary_terms", sa.Column("original_language", sa.String(), nullable=True))
    op.add_column("glossary_terms", sa.Column("original_definition", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("glossary_terms", "original_definition")
    op.drop_column("glossary_terms", "original_language")
    op.drop_column("atomic_claims", "original_content")
    op.drop_column("atomic_claims", "original_language")
    op.drop_column("users", "preferred_language")
