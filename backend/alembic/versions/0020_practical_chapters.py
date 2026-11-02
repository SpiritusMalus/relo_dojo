"""Retain versioned chapter evidence and text-free final verdicts.

Revision ID: 0020_practical_chapters
Revises: 0019_dojo_practice
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0020_practical_chapters"
down_revision = "0019_dojo_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("chapter_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chapter_id", sa.String(40), nullable=False),
        sa.Column("manifest_version", sa.Integer(), nullable=False),
        sa.Column("lang", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("grades", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("receipt_id", sa.Uuid(), nullable=True),
        sa.Column("feedback", postgresql.JSONB(), nullable=True),
        sa.UniqueConstraint("user_id", "chapter_id", "manifest_version", name="uq_chapter_run_manifest"))
    op.create_table("chapter_issued_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("chapter_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("token", sa.String(4000), nullable=False),
        sa.UniqueConstraint("run_id", "ordinal", name="uq_chapter_issued_step"))
    op.create_table("chapter_final_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("chapter_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.UniqueConstraint("run_id", "submission_id", name="uq_chapter_final_submission"))
    op.create_index("ix_chapter_final_run_started", "chapter_final_attempts", ["run_id", "started_at"])


def downgrade() -> None:
    raise RuntimeError("Chapter achievements are retained. Roll back code with DOJO_ENABLED=false; do not erase this schema.")
