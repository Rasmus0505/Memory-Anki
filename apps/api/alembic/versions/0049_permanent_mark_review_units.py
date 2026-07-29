"""Replace node FSRS scheduling with permanent-mark review units.

Revision ID: 0049_permanent_mark_review_units
Revises: 0048_scheduling_units
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from memory_anki.modules.mindmap_document.api import (
    build_document_tree,
    permanent_mark_uids_from_nodes,
    split_scheduling_units,
)

revision = "0049_permanent_mark_review_units"
down_revision = "0048_scheduling_units"
branch_labels = None
depends_on = None

_UNIT_INTERVAL_DAYS_AT_REVISION_0049 = (1, 3, 7, 14, 30, 60, 120, 240, 365)


def _stage_from_legacy_interval_days(value: float | int | None) -> int:
    if value is None:
        return 0
    days = max(0.0, float(value))
    selected = 0
    for index, interval in enumerate(_UNIT_INTERVAL_DAYS_AT_REVISION_0049):
        if interval > days:
            break
        selected = index
    return selected


def _digest(values: list[str]) -> str:
    return hashlib.sha256("\n".join(values).encode("utf-8")).hexdigest()


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
    target = target_dir / f"pre-unit-review-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    source = sqlite3.connect(str(source_path))
    destination = sqlite3.connect(str(target))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()


def _local_date(value: datetime | None) -> date | None:
    value = _as_datetime(value)
    if value is None:
        return None
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.astimezone().date()


def _as_datetime(value: datetime | str | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def upgrade() -> None:
    _backup_database()
    conn = op.get_bind()
    today = date.today()

    op.create_table(
        "review_unit_states",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("anchor_uid", sa.String(128), nullable=False),
        sa.Column("unit_kind", sa.String(16), nullable=False),
        sa.Column("node_uids_json", sa.Text(), nullable=False),
        sa.Column("membership_hash", sa.String(64), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("stage_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_passed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("last_passed_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("ix_review_unit_states_due", "review_unit_states", ["active", "due_date", "palace_id"])
    op.create_index("ix_review_unit_states_palace", "review_unit_states", ["palace_id", "active"])
    op.execute(
        "CREATE UNIQUE INDEX uq_review_unit_states_active_anchor "
        "ON review_unit_states (palace_id, anchor_uid) WHERE active = 1"
    )
    op.create_table(
        "review_unit_rating_operations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("study_session_id", sa.String(64), nullable=False),
        sa.Column("unit_id", sa.String(64), sa.ForeignKey("review_unit_states.id", ondelete="CASCADE"), nullable=False),
        sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_revision", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("retry_after_cards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("before_state_json", sa.Text(), nullable=False),
        sa.Column("after_state_json", sa.Text(), nullable=False),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("ix_review_unit_rating_operations_session", "review_unit_rating_operations", ["study_session_id", "created_at"])
    op.create_index("ix_review_unit_rating_operations_unit", "review_unit_rating_operations", ["unit_id", "created_at"])
    op.create_table(
        "review_session_units",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("study_session_id", sa.String(64), nullable=False),
        sa.Column("unit_id", sa.String(64), sa.ForeignKey("review_unit_states.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_revision", sa.Integer(), nullable=False),
        sa.Column("node_uids_json", sa.Text(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hard_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("again_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_rating", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("study_session_id", "unit_id", name="uq_review_session_units_session_unit"),
    )
    op.create_index("ix_review_session_units_status", "review_session_units", ["study_session_id", "status"])

    palaces = conn.execute(sa.text("SELECT id, editor_doc FROM palaces WHERE deleted_at IS NULL AND archived = 0")).mappings()
    for palace in palaces:
        root_uid, nodes = build_document_tree(palace["editor_doc"])
        if not root_uid:
            continue
        marks = permanent_mark_uids_from_nodes(nodes, root_uid=root_uid)
        units = split_scheduling_units(nodes=nodes, root_uid=root_uid, permanent_mark_uids=marks)
        if not units:
            continue
        old_rows = {
            str(row["node_uid"]): row
            for row in conn.execute(
                sa.text(
                    "SELECT node_uid, due_at, raw_due_at, last_review_at "
                    "FROM review_node_states WHERE palace_id = :palace_id"
                ),
                {"palace_id": palace["id"]},
            ).mappings()
        }
        for unit in units:
            members = list(unit.node_uids)
            rows = [old_rows.get(uid) for uid in members]
            unseen = any(row is None or row["last_review_at"] is None for row in rows)
            stages: list[int] = []
            due_dates: list[date] = []
            if not unseen:
                for row in rows:
                    raw_due = _as_datetime(row["raw_due_at"] or row["due_at"])
                    last_review = _as_datetime(row["last_review_at"])
                    if raw_due is None or last_review is None:
                        unseen = True
                        stages.clear()
                        due_dates.clear()
                        break
                    interval = max(0.0, (raw_due - last_review).total_seconds() / 86400)
                    stages.append(_stage_from_legacy_interval_days(interval))
                    due = _local_date(row["due_at"])
                    if due is not None:
                        due_dates.append(due)
            stage = min(stages) if stages else 0
            due_date = max(today, min(due_dates)) if due_dates else today
            membership_hash = _digest([unit.unit_root_uid, unit.kind, *members])
            content_hash = _digest(
                [f"{uid}:{nodes.get(uid, {}).get('content_fingerprint') or ''}" for uid in members]
            )
            conn.execute(
                sa.text(
                    "INSERT INTO review_unit_states "
                    "(id, palace_id, anchor_uid, unit_kind, node_uids_json, membership_hash, content_hash, revision, stage_index, has_passed, due_date, active, created_at, updated_at) "
                    "VALUES (:id, :palace_id, :anchor_uid, :unit_kind, :nodes, :membership, :content, 1, :stage, :passed, :due_date, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": uuid.uuid4().hex,
                    "palace_id": palace["id"],
                    "anchor_uid": unit.unit_root_uid,
                    "unit_kind": unit.kind,
                    "nodes": json.dumps(members, ensure_ascii=False),
                    "membership": membership_hash,
                    "content": content_hash,
                    "stage": stage,
                    "passed": 0 if unseen else 1,
                    "due_date": due_date,
                },
            )

    for table in (
        "review_daily_plan_items",
        "review_daily_plans",
        "review_calibration_operation_items",
        "review_calibration_operations",
        "review_wave_items",
        "review_waves",
        "review_rating_operation_items",
        "review_rating_operations",
        "review_node_states",
        "freestyle_temporary_marks",
        "palace_review_settings",
        "fsrs_parameter_sets",
        "review_logs",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")

    obsolete_keys = (
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
    for key in obsolete_keys:
        conn.execute(sa.text("DELETE FROM config WHERE key = :key"), {"key": key})


def downgrade() -> None:
    raise RuntimeError("0049 is a one-way product migration; restore the automatic backup instead")
