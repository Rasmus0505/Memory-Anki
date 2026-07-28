"""Remove retired node-level review evidence.

Revision ID: 0051_remove_node_review_history
Revises: 0050_review_unit_encounters
"""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0051_remove_node_review_history"
down_revision = "0050_review_unit_encounters"
branch_labels = None
depends_on = None


def _backup_database() -> None:
    conn = op.get_bind()
    row = conn.exec_driver_sql("PRAGMA database_list").first()
    if row is None or not row[2]:
        return
    source_path = Path(str(row[2]))
    if not source_path.exists():
        return
    target_dir = source_path.parent / "backups" / "migrations"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"pre-remove-node-review-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    shutil.copy2(source_path, target)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{source_path}{suffix}")
        if sidecar.exists():
            shutil.copy2(sidecar, Path(f"{target}{suffix}"))


def upgrade() -> None:
    _backup_database()
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table_name in (
        "mindmap_node_labels",
        "mindmap_recall_events",
        "session_progress",
    ):
        if table_name in existing:
            op.drop_table(table_name)
    if "config" in existing:
        retired_setting_keys = (
            "mastery_horizon_days",
            "scheduling_unit_mode",
            "unit_max_pull_ratio",
            "unit_max_push_ratio",
            "unit_max_retention_drop_pp",
            "unit_min_wave_cards",
            "unit_day_policy",
            "unit_fuzz_max_days",
            "consolidate_enabled",
            "consolidate_floor_days",
            "large_batch_hint_size",
        )
        placeholders = ", ".join("?" for _ in retired_setting_keys)
        op.get_bind().exec_driver_sql(
            f"DELETE FROM config WHERE key IN ({placeholders})",
            retired_setting_keys,
        )


def downgrade() -> None:
    raise RuntimeError("0051 permanently removes retired node-level review history")
