"""add User.ad_reward_day / ad_rewards_used (rewarded-ad koku daily cap)

Revision ID: 0014_user_ad_rewards
Revises: 0013_user_unlocks
Create Date: 2026-06-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014_user_ad_rewards"
down_revision: Union[str, None] = "0013_user_unlocks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ad_reward_day", sa.String(length=10), nullable=False, server_default=""))
    op.add_column("users", sa.Column("ad_rewards_used", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "ad_rewards_used")
    op.drop_column("users", "ad_reward_day")
