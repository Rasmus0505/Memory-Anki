"""normalize client local-wall study_session timestamps to UTC-naive

Revision ID: 0041_normalize_study_session_local_wall_times
Revises: 0040_english_topic_patterns

Background:
  Timed sessions / manual time records used to send naive local wall-clock
  strings (e.g. China 01:00). Frontend display treated naive values as UTC,
  so the table showed +8h (09:00). Formal review rows already store true UTC
  via utc_now_naive and must not be shifted.

  This migration converts only client-originated wall-clock timestamps to UTC
  by interpreting naive values as the host local timezone.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0041_normalize_study_session_local_wall_times"
down_revision = "0040_english_topic_patterns"
branch_labels = None
depends_on = None

MIGRATION_FLAG = "local_wall_to_utc_v1"


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(UTC).replace(tzinfo=None)


def _local_wall_to_utc_naive(value: datetime) -> datetime:
    """Interpret naive datetime as host local wall clock → UTC-naive."""
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    # astimezone() on naive values assumes local timezone.
    return value.astimezone(UTC).replace(tzinfo=None)


def _load_json(raw: Any, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _is_formal_utc_session(summary: dict[str, Any], events: list[Any], completion_method: str) -> bool:
    if isinstance(summary.get("completion_receipt"), dict):
        return True
    if summary.get("migrated_from") == "review_logs":
        return True
    if completion_method == "migrated_review_log":
        return True
    if summary.get(MIGRATION_FLAG):
        return True
    if any(isinstance(event, dict) and event.get("type") == "review_submit" for event in events):
        return True
    # Frozen formal review progress rows store true UTC started_at.
    if isinstance(summary.get("frozen_due_node_uids"), list):
        return True
    return False


def _is_client_local_wall_session(summary: dict[str, Any], events: list[Any], completion_method: str) -> bool:
    if _is_formal_utc_session(summary, events, completion_method):
        return False
    # from-time-record / timed-session payloads always stamp these summary keys.
    if any(
        key in summary
        for key in ("client_source", "scene_segments", "duration_edited", "activity_tag", "reclassified_from")
    ):
        return True
    # Leave/autosave ghosts never carried formal receipts.
    if completion_method in {"saved", "left_page", "restart"}:
        return True
    return False


def _convert_event_timestamps(events: list[Any]) -> list[Any]:
    next_events: list[Any] = []
    for event in events:
        if not isinstance(event, dict):
            next_events.append(event)
            continue
        payload = dict(event)
        for key in ("at", "startedAt", "endedAt", "started_at", "ended_at"):
            if key not in payload:
                continue
            parsed = _parse_datetime(payload.get(key))
            if parsed is not None:
                payload[key] = _local_wall_to_utc_naive(parsed).isoformat()
        next_events.append(payload)
    return next_events


def upgrade() -> None:
    if not _table_exists("study_sessions"):
        return

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            """
            SELECT id, started_at, ended_at, deleted_at, created_at, updated_at,
                   completion_method, summary_json, events_json
            FROM study_sessions
            """
        )
    ).mappings().all()

    for row in rows:
        summary = _load_json(row["summary_json"], {})
        if not isinstance(summary, dict):
            summary = {}
        events = _load_json(row["events_json"], [])
        if not isinstance(events, list):
            events = []
        completion_method = str(row["completion_method"] or "")
        if not _is_client_local_wall_session(summary, events, completion_method):
            continue

        started = _parse_datetime(row["started_at"])
        ended = _parse_datetime(row["ended_at"])
        deleted = _parse_datetime(row["deleted_at"])
        # created_at/updated_at from utc_now_naive are already UTC — leave them.

        next_started = _local_wall_to_utc_naive(started) if started is not None else None
        next_ended = _local_wall_to_utc_naive(ended) if ended is not None else None
        next_deleted = _local_wall_to_utc_naive(deleted) if deleted is not None else None
        next_events = _convert_event_timestamps(events)
        next_summary = {**summary, MIGRATION_FLAG: True}

        connection.execute(
            sa.text(
                """
                UPDATE study_sessions
                SET started_at = :started_at,
                    ended_at = :ended_at,
                    deleted_at = :deleted_at,
                    events_json = :events_json,
                    summary_json = :summary_json
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "started_at": next_started.isoformat(sep=" ") if next_started else None,
                "ended_at": next_ended.isoformat(sep=" ") if next_ended else None,
                "deleted_at": next_deleted.isoformat(sep=" ") if next_deleted else None,
                "events_json": json.dumps(next_events, ensure_ascii=False),
                "summary_json": json.dumps(next_summary, ensure_ascii=False),
            },
        )


def downgrade() -> None:
    # Irreversible data fix: UTC conversion cannot be safely undone without the
    # original host offset snapshot. Leave data as-is.
    return
