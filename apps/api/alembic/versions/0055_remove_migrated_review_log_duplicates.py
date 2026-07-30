"""Remove duplicate study sessions projected from retired review logs.

Revision ID: 0055_remove_migrated_review_log_duplicates
Revises: 0054_encounter_effective_seconds
"""

from __future__ import annotations

from alembic import op

revision = "0055_remove_migrated_review_log_duplicates"
down_revision = "0054_encounter_effective_seconds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # These rows were a second read projection over authoritative timer or
    # formal-review completion rows.  They must not survive as independent
    # billable time records.
    op.execute(
        "DELETE FROM study_sessions "
        "WHERE completion_method = 'migrated_review_log' "
        "AND json_extract(summary_json, '$.migrated_from') = 'review_logs'"
    )


def downgrade() -> None:
    raise RuntimeError("0055 permanently removes duplicate review-log projections")
