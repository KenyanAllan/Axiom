"""Add response_image_s3_key to activity_attempts for visual activity types."""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activity_attempts",
        sa.Column("response_image_s3_key", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activity_attempts", "response_image_s3_key")
