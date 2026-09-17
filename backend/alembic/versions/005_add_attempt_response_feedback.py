"""Add student_response and feedback columns to activity_attempts table.

Revision ID: 005
Revises: 004
Create Date: 2026-09-16
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activity_attempts", sa.Column("student_response", sa.Text(), nullable=True))
    op.add_column("activity_attempts", sa.Column("feedback", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("activity_attempts", "feedback")
    op.drop_column("activity_attempts", "student_response")
