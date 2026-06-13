"""add awarded_tokens (one-time-use guard for /check koku awards — anti-replay)

Revision ID: 0008_awarded_tokens
Revises: 0007_events
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008_awarded_tokens"
down_revision: Union[str, None] = "0007_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "awarded_tokens",
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index("ix_awarded_tokens_created_at", "awarded_tokens", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_awarded_tokens_created_at", table_name="awarded_tokens")
    op.drop_table("awarded_tokens")
