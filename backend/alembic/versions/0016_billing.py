"""web-checkout billing: paid premium expiry + webhook idempotency

Renames users.is_premium -> users.premium_override (now the manual/lifetime comp flag) and adds
users.premium_until (paid-subscription expiry). Effective premium is computed in the ORM
(User.is_premium property = override OR premium_until in the future), so nothing else changes.
Adds processed_payments — the idempotency guard for YooKassa / crypto payment webhooks.

Revision ID: 0016_billing
Revises: 0015_sent_emails
Create Date: 2026-06-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016_billing"
down_revision: Union[str, None] = "0015_sent_emails"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename in place (metadata-only in Postgres — keeps existing comped accounts).
    op.alter_column("users", "is_premium", new_column_name="premium_override")
    op.add_column(
        "users",
        sa.Column("premium_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "processed_payments",
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("plan", sa.String(length=40), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("provider", "external_id"),
    )


def downgrade() -> None:
    op.drop_table("processed_payments")
    op.drop_column("users", "premium_until")
    op.alter_column("users", "premium_override", new_column_name="is_premium")
