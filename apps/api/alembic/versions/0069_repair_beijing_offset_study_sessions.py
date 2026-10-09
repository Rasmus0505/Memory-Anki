"""shift automatic study rows that stored Beijing wall time as UTC

Revision ID: 0069_repair_beijing_offset_study_sessions
Revises: 0068_clamp_session_duration_span

A client local clock of 22:00 was sometimes stored as 22:00 UTC. The list then
showed 06:00 the next day, eight hours late. Correct UTC rows have started_at
near created_at. A row whose started_at is about eight hours after the server
created_at has that signature.

Hand-edited durations are never rewritten.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0069_repair_beijing_offset_study_sessions"
down_revision = "0068_clamp_session_duration_span"
branch_labels = None
depends_on = None

SHIFT = timedelta(hours=8)
REPAIR_FLAG = "beijing_offset_repair"


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


def _load_summary(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    try:
        parsed = json.loads(str(raw or "{}"))
    except (TypeError, ValueError):
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def _looks_like_beijing_stored_as_utc(started_at: datetime, created_at: datetime) -> bool:
    ahead = (started_at - created_at).total_seconds()
    return 6 * 3600 <= ahead <= 10 * 3600


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, started_at, ended_at, created_at, summary_json "
            "FROM study_sessions WHERE deleted_at IS NULL"
        )
    ).mappings().all()
    for row in rows:
        summary = _load_summary(row["summary_json"])
        if summary.get("duration_edited") or summary.get(REPAIR_FLAG):
            continue
        started = _parse_datetime(row["started_at"])
        created = _parse_datetime(row["created_at"])
        if started is None or created is None or not _looks_like_beijing_stored_as_utc(started, created):
            continue
        ended = _parse_datetime(row["ended_at"])
        summary[REPAIR_FLAG] = {
            "previous_started_at": started.isoformat(),
            "previous_ended_at": ended.isoformat() if ended else None,
            "shift_hours": -8,
        }
        connection.execute(
            sa.text(
                "UPDATE study_sessions SET started_at = :started_at, ended_at = :ended_at, "
                "summary_json = :summary_json WHERE id = :session_id"
            ),
            {
                "session_id": row["id"],
                "started_at": started - SHIFT,
                "ended_at": (ended - SHIFT) if ended else None,
                "summary_json": json.dumps(summary, ensure_ascii=False),
            },
        )


def downgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, started_at, ended_at, summary_json FROM study_sessions")
    ).mappings().all()
    for row in rows:
        summary = _load_summary(row["summary_json"])
        repair = summary.get(REPAIR_FLAG)
        if not isinstance(repair, dict):
            continue
        started = _parse_datetime(repair.get("previous_started_at"))
        ended = _parse_datetime(repair.get("previous_ended_at"))
        summary.pop(REPAIR_FLAG, None)
        connection.execute(
            sa.text(
                "UPDATE study_sessions SET started_at = :started_at, ended_at = :ended_at, "
                "summary_json = :summary_json WHERE id = :session_id"
            ),
            {
                "session_id": row["id"],
                "started_at": started,
                "ended_at": ended,
                "summary_json": json.dumps(summary, ensure_ascii=False),
            },
        )
