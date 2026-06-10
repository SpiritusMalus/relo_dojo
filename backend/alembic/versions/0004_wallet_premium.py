"""add users.is_premium / coins / freezes (economy: koku wallet + Black Belt flag)

Revision ID: 0004_wallet_premium
Revises: 0003_starter_quota
Create Date: 2026-06-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_wallet_premium"
down_revision: Union[str, None] = "0003_starter_quota"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_premium", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("coins", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("freezes", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "freezes")
    op.drop_column("users", "coins")
    op.drop_column("users", "is_premium")
