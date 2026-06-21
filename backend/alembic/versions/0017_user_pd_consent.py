"""add User.pd_consent_version / pd_consent_at (152-ФЗ cross-border consent audit)

Standalone personal-data + cross-border consent (transfer to Google LLC / Gemini, США),
kept separate from the оферта/Terms per the 01.09.2025 rule. Records the accepted version
string + acceptance timestamp; surfaced in the data export.

Revision ID: 0017_user_pd_consent
Revises: 0016_billing
Create Date: 2026-06-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017_user_pd_consent"
down_revision: Union[str, None] = "0016_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("pd_consent_version", sa.String(length=20), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("pd_consent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "pd_consent_at")
    op.drop_column("users", "pd_consent_version")
