"""add claimed_contracts (one-time-per-day guard for daily-contract koku payouts)

Revision ID: 0010_claimed_contracts
Revises: 0009_user_cosmetics
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010_claimed_contracts"
down_revision: Union[str, None] = "0009_user_cosmetics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "claimed_contracts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("contract_id", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "day", "contract_id"),
    )


def downgrade() -> None:
    op.drop_table("claimed_contracts")
