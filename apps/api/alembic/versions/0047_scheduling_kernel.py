"""Scheduling kernel refactor: parameter sets, palace review settings, daily plans.

Also cleans dead review config keys and bumps maximum_interval off the legacy
180-day cap (only when the stored value still equals the old default).

Revision ID: 0047_scheduling_kernel
Revises: 0046_temporary_freestyle_marks
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0047_scheduling_kernel"
down_revision = "0046_temporary_freestyle_marks"
branch_labels = None
depends_on = None

DEAD_CONFIG_KEYS = (
    "ebbinghaus_intervals",
    "auto_smooth_overdue",
    "overdue_smoothing_days",
    "overdue_smoothing_threshold",
    "sleep_review_time",
    "early_review_anchor",
    "mastered_interval",
    # 旧语义是"每日宫殿数上限"，与新的按卡片数额度不同名不迁移值。
    "daily_max_reviews",
)

NEW_CONFIG_DEFAULTS = {
    "enable_fuzzing": "true",
    "daily_new_limit": "20",
    "daily_review_limit": "200",
}


def upgrade() -> None:
    op.create_table(
        "fsrs_parameter_sets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("weights_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="optimized"),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("log_loss_before", sa.Float(), nullable=True),
        sa.Column("log_loss_after", sa.Float(), nullable=True),
        sa.Column("calibration_json", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="candidate"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
        sa.Column("deactivated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_fsrs_parameter_sets_status", "fsrs_parameter_sets", ["status"])

    op.create_table(
        "palace_review_settings",
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "aggregation_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("aggregation_max_pull_days", sa.Integer(), nullable=True),
        sa.Column("aggregation_max_push_days", sa.Integer(), nullable=True),
        sa.Column("daily_new_limit_override", sa.Integer(), nullable=True),
        sa.Column("daily_review_limit_override", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "review_daily_plans",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("scope", sa.String(length=24), nullable=False, server_default="palace"),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("review_quota", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("new_quota", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("regenerated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "local_date", "scope", "palace_id", name="uq_review_daily_plans_date_scope"
        ),
    )
    op.create_index("ix_review_daily_plans_date", "review_daily_plans", ["local_date"])

    op.create_table(
        "review_daily_plan_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "plan_id",
            sa.String(length=64),
            sa.ForeignKey("review_daily_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("palace_id", sa.Integer(), nullable=True),
        sa.Column("item_key", sa.String(length=192), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("defer_reason", sa.String(length=32), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("plan_id", "item_key", name="uq_review_daily_plan_items_key"),
    )
    op.create_index(
        "ix_review_daily_plan_items_status",
        "review_daily_plan_items",
        ["plan_id", "kind", "status"],
    )

    conn = op.get_bind()
    for key in DEAD_CONFIG_KEYS:
        conn.execute(sa.text("DELETE FROM config WHERE key = :key"), {"key": key})
    for key, value in NEW_CONFIG_DEFAULTS.items():
        exists = conn.execute(
            sa.text("SELECT 1 FROM config WHERE key = :key"), {"key": key}
        ).first()
        if exists is None:
            conn.execute(
                sa.text(
                    "INSERT INTO config (key, value, updated_at)"
                    " VALUES (:key, :value, CURRENT_TIMESTAMP)"
                ),
                {"key": key, "value": value},
            )
    # 只把仍是旧默认 180 的值抬到 FSRS 官方默认；用户自定义的其他值不动。
    conn.execute(
        sa.text(
            "UPDATE config SET value = '36500', updated_at = CURRENT_TIMESTAMP"
            " WHERE key = 'maximum_interval' AND value = '180'"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_review_daily_plan_items_status", table_name="review_daily_plan_items")
    op.drop_table("review_daily_plan_items")
    op.drop_index("ix_review_daily_plans_date", table_name="review_daily_plans")
    op.drop_table("review_daily_plans")
    op.drop_table("palace_review_settings")
    op.drop_index("ix_fsrs_parameter_sets_status", table_name="fsrs_parameter_sets")
    op.drop_table("fsrs_parameter_sets")
