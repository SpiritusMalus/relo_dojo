"""add User.correct_run (server-side combo koku run, engagement v2)

Revision ID: 0012_user_correct_run
Revises: 0011_user_last_win_day
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012_user_correct_run"
down_revision: Union[str, None] = "0011_user_last_win_day"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("correct_run", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "correct_run")
