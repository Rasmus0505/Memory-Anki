"""Add stable timer identity and optimistic write versions to study sessions.

Revision ID: 0058_study_session_write_versions
Revises: 0057_review_unit_rating_batch_id
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0058_study_session_write_versions"
down_revision = "0057_review_unit_rating_batch_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # These are additive columns.  Server defaults keep the migration valid for
    # existing installations and for rows created by older clients.
    op.add_column(
        "study_sessions",
        sa.Column("session_key", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "study_sessions",
        sa.Column("client_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "study_sessions",
        sa.Column("last_operation_id", sa.String(length=128), nullable=True),
    )
    # A legacy row has no target identity.  Its primary key is the only stable
    # identity available, so use it as a deterministic fallback rather than
    # inventing a timestamp/random value.
    op.execute(
        sa.text(
            "UPDATE study_sessions "
            "SET session_key = id "
            "WHERE session_key IS NULL OR session_key = ''"
        )
    )
    op.create_index(
        "ix_study_sessions_session_key",
        "study_sessions",
        ["session_key", "status", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_study_sessions_session_key", table_name="study_sessions")
    op.drop_column("study_sessions", "last_operation_id")
    op.drop_column("study_sessions", "client_revision")
    op.drop_column("study_sessions", "session_key")
