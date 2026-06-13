"""add User.unlocks (koku-bought content unlocks, engagement v2 Phase 3)

Revision ID: 0013_user_unlocks
Revises: 0012_user_correct_run
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0013_user_unlocks"
down_revision: Union[str, None] = "0012_user_correct_run"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "unlocks",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "unlocks")
