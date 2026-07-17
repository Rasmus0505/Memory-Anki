"""unify on FSRS: drop legacy schedules, add vocab FSRS columns

Revision ID: 0039_unify_fsrs_drop_legacy_schedules
Revises: 0038_quiz_question_node_bindings
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# memory-anki: allow-destructive-migration — ReviewSchedule/stage tables and Ebbinghaus history
# are intentionally retired; formal review and vocabulary are FSRS-only (no compatibility path).

revision = "0039_unify_fsrs_drop_legacy_schedules"
down_revision = "0038_quiz_question_node_bindings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # session_progress used to FK into review_schedules; drop that link first.
    try:
        with op.batch_alter_table("session_progress") as batch:
            batch.drop_constraint(
                "fk_session_progress_review_schedule_id_review_schedules",
                type_="foreignkey",
            )
    except Exception:
        # SQLite/table may already lack the named constraint; recreate without FK below.
        pass
    try:
        with op.batch_alter_table("session_progress") as batch:
            # Ensure column remains nullable integer without FK for leftover rows.
            batch.alter_column(
                "review_schedule_id",
                existing_type=sa.Integer(),
                nullable=True,
            )
    except Exception:
        pass

    # Drop legacy stage/schedule tables (history discarded by product decision).
    op.execute("DROP TABLE IF EXISTS review_stage_adjustments")
    # Drop dependents that still name review_schedules, then the table itself.
    op.execute("DROP TABLE IF EXISTS review_schedules")

    # Vocab notes: FSRS card columns
    with op.batch_alter_table("english_reading_vocabulary_notes") as batch:
        batch.add_column(sa.Column("fsrs_state", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("fsrs_step", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("stability", sa.Float(), nullable=True))
        batch.add_column(sa.Column("difficulty", sa.Float(), nullable=True))
        batch.add_column(sa.Column("due_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("last_review_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("desired_retention", sa.Float(), nullable=False, server_default="0.9")
        )
        batch.add_column(
            sa.Column("maximum_interval", sa.Integer(), nullable=False, server_default="180")
        )
        batch.add_column(
            sa.Column(
                "scheduler_version",
                sa.String(length=32),
                nullable=False,
                server_default="fsrs-6.3.1",
            )
        )

    # Backfill due_at from legacy next_due_at / next_due_date
    op.execute(
        """
        UPDATE english_reading_vocabulary_notes
        SET due_at = COALESCE(next_due_at, datetime(next_due_date || ' 00:00:00'))
        WHERE due_at IS NULL
        """
    )
    op.execute(
        """
        UPDATE english_reading_vocabulary_notes
        SET algorithm_used = 'FSRS', review_type = 'fsrs'
        """
    )

    # Drop needs_practice columns where present (SQLite batch alter).
    for table in ("palaces", "palace_segments", "palace_mini_palaces"):
        try:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("needs_practice")
        except Exception:
            # Column may already be absent on partial DBs.
            pass


def downgrade() -> None:
    raise NotImplementedError("FSRS unification is not reversible")
