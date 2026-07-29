"""Add an explicit initial-learning stage before the one-day review.

Revision ID: 0053_add_initial_review_stage
Revises: 0052_review_unit_schedule_batches
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0053_add_initial_review_stage"
down_revision = "0052_review_unit_schedule_batches"
branch_labels = None
depends_on = None

_INTERVAL_DAYS = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)


def _shift_stage(value: Any, *, has_passed: bool) -> int:
    stage = max(0, min(int(value or 0), len(_INTERVAL_DAYS) - 2))
    return stage + 1 if stage > 0 or has_passed else 0


def _migrate_json_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_migrate_json_value(item) for item in value]
    if not isinstance(value, dict):
        return value

    migrated = {key: _migrate_json_value(item) for key, item in value.items()}
    if "stage_index" in migrated and "has_passed" in migrated:
        stage = _shift_stage(
            migrated.get("stage_index"),
            has_passed=bool(migrated.get("has_passed")),
        )
        migrated["stage_index"] = stage
        if "interval_days" in migrated:
            migrated["interval_days"] = _INTERVAL_DAYS[stage]

    if "target_stage_index" in migrated:
        passed = bool(migrated.get("passed"))
        if passed:
            stage = min(int(migrated.get("target_stage_index") or 0) + 1, 9)
        else:
            stage = 0
        migrated["target_stage_index"] = stage
        if "target_interval_days" in migrated:
            migrated["target_interval_days"] = _INTERVAL_DAYS[stage]
    return migrated


def _migrate_json_column(conn: Any, table: str, column: str) -> None:
    rows = conn.execute(sa.text(f"SELECT id, {column} FROM {table}")).mappings()
    for row in rows:
        raw = row[column]
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        migrated = _migrate_json_value(payload)
        conn.execute(
            sa.text(f"UPDATE {table} SET {column} = :payload WHERE id = :id"),
            {
                "id": row["id"],
                "payload": json.dumps(migrated, ensure_ascii=False),
            },
        )


def _as_local_day(value: Any) -> date | None:
    if value is None:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    aware = parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    return aware.astimezone().date()


def _first_remembered_today_unit_ids(conn: Any, today: date) -> set[str]:
    rows = conn.execute(
        sa.text(
            "SELECT unit_id, created_at, before_state_json "
            "FROM review_unit_rating_operations "
            "WHERE rating = 3 AND passed = 1 "
            "AND undone_at IS NULL AND replaced_at IS NULL"
        )
    ).mappings()
    matched: set[str] = set()
    for row in rows:
        if _as_local_day(row["created_at"]) != today:
            continue
        try:
            before = json.loads(row["before_state_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        state = before.get("state") if isinstance(before, dict) else None
        if isinstance(state, dict) and not bool(state.get("has_passed")):
            matched.add(str(row["unit_id"]))
    return matched


def upgrade() -> None:
    conn = op.get_bind()
    today = datetime.now().astimezone().date()
    first_remembered_today = _first_remembered_today_unit_ids(conn, today)

    for table, column in (
        ("review_unit_rating_operations", "before_state_json"),
        ("review_unit_rating_operations", "after_state_json"),
        ("review_unit_encounters", "baseline_state_json"),
        ("review_unit_schedule_batches", "entries_json"),
    ):
        _migrate_json_column(conn, table, column)

    conn.execute(
        sa.text(
            "UPDATE review_unit_states "
            "SET stage_index = CASE "
            "WHEN stage_index > 0 OR has_passed = 1 THEN MIN(stage_index + 1, 9) "
            "ELSE 0 END"
        )
    )

    if first_remembered_today:
        tomorrow = today + timedelta(days=1)
        placeholders = ", ".join(f":unit_{index}" for index, _ in enumerate(first_remembered_today))
        params = {
            f"unit_{index}": unit_id
            for index, unit_id in enumerate(sorted(first_remembered_today))
        }
        params["due_date"] = tomorrow.isoformat()
        conn.execute(
            sa.text(
                "UPDATE review_unit_states SET stage_index = 1, due_date = :due_date, "
                "revision = revision + 1, updated_at = CURRENT_TIMESTAMP "
                f"WHERE active = 1 AND has_passed = 1 AND id IN ({placeholders})"
            ),
            params,
        )


def downgrade() -> None:
    raise RuntimeError(
        "0053 changes review-stage semantics and repairs live due dates; restore a backup instead"
    )
