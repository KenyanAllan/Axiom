"""Add image_s3_keys column to chat_messages table.

Revision ID: 006
Revises: 005
Create Date: 2026-09-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("image_s3_keys", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "image_s3_keys")
