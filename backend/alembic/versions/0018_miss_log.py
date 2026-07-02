"""add miss_log (server-side per-topic miss history — cross-device personalization RAG)

Revision ID: 0018_miss_log
Revises: 0017_user_pd_consent
Create Date: 2026-07-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0018_miss_log"
down_revision: Union[str, None] = "0017_user_pd_consent"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "miss_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("topic", sa.String(length=60), nullable=False),
        sa.Column("text", sa.String(length=160), nullable=False),
        sa.Column("misses", sa.Integer(), server_default="1", nullable=False),
        sa.Column("missed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "topic", "text", name="uq_miss_log_user_topic_text"),
    )
    op.create_index("ix_miss_log_user_topic_at", "miss_log", ["user_id", "topic", "missed_at"])


def downgrade() -> None:
    op.drop_index("ix_miss_log_user_topic_at", table_name="miss_log")
    op.drop_table("miss_log")
