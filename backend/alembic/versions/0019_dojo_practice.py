"""Add opt-in My Dojo practice evidence; existing progress and inventory stay intact.

Revision ID: 0019_dojo_practice
Revises: 0018_miss_log
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0019_dojo_practice"
down_revision = "0018_miss_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("dojo_target", sa.String(40), nullable=True))
    op.create_table("learning_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("grades", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reward_day", sa.String(10), nullable=True),
        sa.UniqueConstraint("user_id", "client_id", name="uq_learning_session_client"))
    op.create_index("ix_learning_sessions_user_created", "learning_sessions", ["user_id", "created_at"])
    op.create_table("learning_issued_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("learning_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("rewarded", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("exercise_type", sa.String(40), nullable=False))
    op.create_index("ix_learning_items_session", "learning_issued_items", ["session_id"])
    op.create_table("dojo_practice_days",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.String(10), primary_key=True))
    op.create_table("dojo_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_id", sa.String(40), nullable=False),
        sa.Column("item_id", sa.String(40), nullable=False),
        sa.Column("practice_days", sa.Integer(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "rule_id", "item_id", name="uq_dojo_grant_rule"))


def downgrade() -> None:
    # Operational rollback is feature-off + compatible previous code. Deliberately retain earned
    # evidence and preferences: a downgrade must not erase rewards or make a future upgrade regrant.
    raise RuntimeError("My Dojo evidence is retained. Roll back code with DOJO_ENABLED=false; do not downgrade this schema.")
