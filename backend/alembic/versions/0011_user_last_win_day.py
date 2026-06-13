"""add User.last_win_day (first-win-of-day koku bonus, engagement v2)

Revision ID: 0011_user_last_win_day
Revises: 0010_claimed_contracts
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011_user_last_win_day"
down_revision: Union[str, None] = "0010_claimed_contracts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_win_day", sa.String(length=10), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("users", "last_win_day")
