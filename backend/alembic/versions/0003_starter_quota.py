"""add users.starter_day / starter_used (server-side starter quota)

Revision ID: 0003_starter_quota
Revises: 0002_user_is_verified
Create Date: 2026-06-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_starter_quota"
down_revision: Union[str, None] = "0002_user_is_verified"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("starter_day", sa.String(length=10), nullable=False, server_default=""))
    op.add_column("users", sa.Column("starter_used", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "starter_used")
    op.drop_column("users", "starter_day")
