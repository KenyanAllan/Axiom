"""Add figures table for extracted images/charts from source documents."""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "figures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_document_id",
            sa.Integer(),
            sa.ForeignKey("source_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=False),
        sa.Column("figure_type", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("labels", JSONB, nullable=True),
        sa.Column("ocr_text", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(1024)),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("is_decorative", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "figure_claims",
        sa.Column(
            "figure_id",
            sa.Integer(),
            sa.ForeignKey("figures.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "claim_id",
            sa.String(),
            sa.ForeignKey("atomic_claims.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("similarity_score", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("figure_claims")
    op.drop_table("figures")
