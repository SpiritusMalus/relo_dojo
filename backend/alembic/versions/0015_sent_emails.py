"""add sent_emails (one-time guard for Day-2 / Day-6 re-engagement emails)

Revision ID: 0015_sent_emails
Revises: 0014_user_ad_rewards
Create Date: 2026-06-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015_sent_emails"
down_revision: Union[str, None] = "0014_user_ad_rewards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sent_emails",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "kind"),
    )


def downgrade() -> None:
    op.drop_table("sent_emails")
