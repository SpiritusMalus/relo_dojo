"""add events (analytics instrumentation — north-star Day-7 retention)

Revision ID: 0007_events
Revises: 0006_learner_profile
Create Date: 2026-06-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007_events"
down_revision: Union[str, None] = "0006_learner_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("subject", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("props", JSONB(), nullable=False),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_subject_ts", "events", ["subject", "ts"])
    op.create_index("ix_events_name_ts", "events", ["name", "ts"])


def downgrade() -> None:
    op.drop_index("ix_events_name_ts", table_name="events")
    op.drop_index("ix_events_subject_ts", table_name="events")
    op.drop_table("events")
