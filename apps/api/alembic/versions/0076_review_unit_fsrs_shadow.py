"""Shadow FSRS state for review units.

Revision ID: 0076_review_unit_fsrs_shadow
Revises: 0075_unit_hard_penalty_day

Additive only. These tables are diagnostics: the production ladder still owns
``review_unit_states.stage_index`` and ``due_date``. Dropping both tables changes
no learner-visible schedule.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0076_review_unit_fsrs_shadow"
down_revision = "0075_unit_hard_penalty_day"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_unit_fsrs_shadow_states",
        sa.Column("unit_id", sa.String(length=64), nullable=False),
        sa.Column("stability", sa.Float(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("fsrs_state", sa.Integer(), nullable=True),
        sa.Column("fsrs_step", sa.Integer(), nullable=True),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("last_review", sa.DateTime(), nullable=True),
        sa.Column("scheduler_version", sa.String(length=32), nullable=False),
        sa.Column("desired_retention", sa.Float(), nullable=False),
        sa.Column("maximum_interval", sa.Integer(), nullable=False),
        sa.Column("replayed_operations", sa.Integer(), nullable=False),
        sa.Column("last_operation_id", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["unit_id"],
            ["review_unit_states.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("unit_id"),
    )
    op.create_table(
        "review_unit_fsrs_shadow_ratings",
        sa.Column("id", sa.String(length=256), nullable=False),
        sa.Column("unit_id", sa.String(length=64), nullable=False),
        sa.Column("palace_id", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("rated_at", sa.DateTime(), nullable=False),
        sa.Column("study_day", sa.Date(), nullable=False),
        sa.Column("ladder_stage_before", sa.Integer(), nullable=False),
        sa.Column("ladder_due_before", sa.Date(), nullable=False),
        sa.Column("ladder_has_passed_before", sa.Boolean(), nullable=False),
        sa.Column("ladder_stage_after", sa.Integer(), nullable=False),
        sa.Column("ladder_due_after", sa.Date(), nullable=False),
        sa.Column("ladder_interval_days", sa.Integer(), nullable=False),
        sa.Column("fsrs_state_before_json", sa.Text(), nullable=False),
        sa.Column("fsrs_state_after_json", sa.Text(), nullable=False),
        sa.Column("fsrs_due_raw", sa.Date(), nullable=True),
        sa.Column("fsrs_due_product", sa.Date(), nullable=False),
        sa.Column("fsrs_interval_raw_days", sa.Integer(), nullable=False),
        sa.Column("fsrs_interval_days", sa.Integer(), nullable=False),
        sa.Column("due_delta_days", sa.Integer(), nullable=False),
        sa.Column("interval_delta_days", sa.Integer(), nullable=False),
        sa.Column("schedule_changed", sa.Boolean(), nullable=False),
        sa.Column("schedule_locked", sa.Boolean(), nullable=False),
        sa.Column("hard_penalized_today", sa.Boolean(), nullable=False),
        sa.Column("hard_penalty_applied", sa.Boolean(), nullable=False),
        sa.Column("fsrs_applied", sa.Boolean(), nullable=False),
        sa.Column("horizon_applied", sa.Boolean(), nullable=False),
        sa.Column("fuzz_applied", sa.Boolean(), nullable=False),
        sa.Column("scheduler_version", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["unit_id"],
            ["review_unit_states.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["palace_id"],
            ["palaces.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_review_unit_fsrs_shadow_ratings_unit",
        "review_unit_fsrs_shadow_ratings",
        ["unit_id", "created_at"],
    )
    op.create_index(
        "ix_review_unit_fsrs_shadow_ratings_created",
        "review_unit_fsrs_shadow_ratings",
        ["created_at"],
    )
    op.create_index(
        "ix_review_unit_fsrs_shadow_ratings_delta",
        "review_unit_fsrs_shadow_ratings",
        ["due_delta_days"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_review_unit_fsrs_shadow_ratings_delta",
        table_name="review_unit_fsrs_shadow_ratings",
    )
    op.drop_index(
        "ix_review_unit_fsrs_shadow_ratings_created",
        table_name="review_unit_fsrs_shadow_ratings",
    )
    op.drop_index(
        "ix_review_unit_fsrs_shadow_ratings_unit",
        table_name="review_unit_fsrs_shadow_ratings",
    )
    op.drop_table("review_unit_fsrs_shadow_ratings")
    op.drop_table("review_unit_fsrs_shadow_states")
