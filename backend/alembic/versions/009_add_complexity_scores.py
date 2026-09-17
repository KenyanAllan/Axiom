"""Add complexity_score to topics and atomic_claims for smart difficulty estimation."""

from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("complexity_score", sa.Float(), nullable=True))
    op.add_column("atomic_claims", sa.Column("complexity_score", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("atomic_claims", "complexity_score")
    op.drop_column("topics", "complexity_score")
