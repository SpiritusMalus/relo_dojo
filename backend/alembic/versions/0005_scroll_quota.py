"""add users.scroll_day / scrolls_used (daily cap for scroll rewards)

Revision ID: 0005_scroll_quota
Revises: 0004_wallet_premium
Create Date: 2026-06-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_scroll_quota"
down_revision: Union[str, None] = "0004_wallet_premium"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("scroll_day", sa.String(length=10), nullable=False, server_default=""))
    op.add_column("users", sa.Column("scrolls_used", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "scrolls_used")
    op.drop_column("users", "scroll_day")
