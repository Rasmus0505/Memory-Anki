"""backfill trustworthy zero-duration study sessions

Revision ID: 0031_backfill_zero_duration_sessions
Revises: 0030_pdf_document_library
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0031_backfill_zero_duration_sessions"
down_revision = "0030_pdf_document_library"
branch_labels = None
depends_on = None

MAX_TRUSTWORTHY_SECONDS = 4 * 60 * 60
MAX_REVIEW_END_DRIFT_SECONDS = 2 * 60
BACKFILL_VERSION = 1


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone().replace(tzinfo=None)


def _load_summary(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    try:
        parsed = json.loads(str(raw or "{}"))
    except (TypeError, ValueError):
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def _summary_with_backfill(
    raw: Any,
    *,
    source: str,
    effective_seconds: int,
) -> str:
    summary = _load_summary(raw)
    summary["duration_backfill"] = {
        "version": BACKFILL_VERSION,
        "source": source,
        "effective_seconds": effective_seconds,
    }
    return json.dumps(summary, ensure_ascii=False)


def _trustworthy_span(started_at: Any, ended_at: Any) -> int | None:
    started = _parse_datetime(started_at)
    ended = _parse_datetime(ended_at)
    if started is None or ended is None or started.date() != ended.date():
        return None
    duration = int((ended - started).total_seconds())
    if duration < 1 or duration > MAX_TRUSTWORTHY_SECONDS:
        return None
    return duration


def _scene_segment_seconds(summary: dict[str, Any]) -> int | None:
    segments = summary.get("scene_segments")
    if not isinstance(segments, list):
        return None
    total = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        raw_seconds = segment.get("effectiveSeconds", segment.get("effective_seconds", 0))
        try:
            total += max(0, int(raw_seconds or 0))
        except (TypeError, ValueError):
            continue
    if total < 1 or total > MAX_TRUSTWORTHY_SECONDS:
        return None
    return total


def _update_study_session(
    connection: sa.Connection,
    *,
    session_id: str,
    effective_seconds: int,
    summary_json: str,
    started_at: datetime | None = None,
) -> None:
    assignments = [
        "effective_seconds = :effective_seconds",
        "summary_json = :summary_json",
    ]
    params: dict[str, Any] = {
        "session_id": session_id,
        "effective_seconds": effective_seconds,
        "summary_json": summary_json,
    }
    if started_at is not None:
        assignments.append("started_at = :started_at")
        params["started_at"] = started_at
    connection.execute(
        sa.text(
            f"UPDATE study_sessions SET {', '.join(assignments)} "
            "WHERE id = :session_id AND effective_seconds = 0"
        ),
        params,
    )


def _backfill_review_logs(connection: sa.Connection) -> None:
    completed_rows = connection.execute(
        sa.text(
            "SELECT id, target_id, ended_at, summary_json "
            "FROM study_sessions "
            "WHERE status = 'completed' AND effective_seconds = 0 "
            "AND id LIKE 'review-log-%'"
        )
    ).mappings().all()
    progress_rows = {
        row["target_id"]: row
        for row in connection.execute(
            sa.text(
                "SELECT target_id, started_at, ended_at "
                "FROM study_sessions "
                "WHERE target_type = 'review_schedule' "
                "AND id LIKE 'session-progress-review-%'"
            )
        ).mappings()
        if row["target_id"] is not None
    }
    review_log_rows = {
        int(row["id"]): row
        for row in connection.execute(
            sa.text("SELECT id, duration_seconds FROM review_logs")
        ).mappings()
    }

    for completed in completed_rows:
        try:
            review_log_id = int(str(completed["id"]).removeprefix("review-log-"))
        except ValueError:
            continue
        review_log = review_log_rows.get(review_log_id)
        progress = progress_rows.get(completed["target_id"])
        if review_log is None or progress is None:
            continue
        if int(review_log["duration_seconds"] or 0) > 0:
            continue
        completed_end = _parse_datetime(completed["ended_at"])
        progress_end = _parse_datetime(progress["ended_at"])
        if completed_end is None or progress_end is None:
            continue
        if abs((progress_end - completed_end).total_seconds()) > MAX_REVIEW_END_DRIFT_SECONDS:
            continue
        effective_seconds = _trustworthy_span(progress["started_at"], completed_end)
        if effective_seconds is None:
            continue
        connection.execute(
            sa.text(
                "UPDATE review_logs SET duration_seconds = :effective_seconds "
                "WHERE id = :review_log_id AND duration_seconds = 0"
            ),
            {
                "review_log_id": review_log_id,
                "effective_seconds": effective_seconds,
            },
        )
        _update_study_session(
            connection,
            session_id=str(completed["id"]),
            effective_seconds=effective_seconds,
            started_at=completed_end - timedelta(seconds=effective_seconds),
            summary_json=_summary_with_backfill(
                completed["summary_json"],
                source="review_progress_span",
                effective_seconds=effective_seconds,
            ),
        )


def _backfill_completed_client_sessions(connection: sa.Connection) -> None:
    rows = connection.execute(
        sa.text(
            "SELECT id, started_at, ended_at, summary_json "
            "FROM study_sessions "
            "WHERE status = 'completed' AND effective_seconds = 0 "
            "AND id NOT LIKE 'review-log-%' "
            "AND id NOT LIKE 'session-progress-%'"
        )
    ).mappings().all()
    for row in rows:
        summary = _load_summary(row["summary_json"])
        if bool(summary.get("duration_edited")):
            continue
        effective_seconds = _scene_segment_seconds(summary)
        source = "scene_segments"
        if effective_seconds is None:
            if summary.get("client_source") not in {"desktop", "pwa"}:
                continue
            effective_seconds = _trustworthy_span(row["started_at"], row["ended_at"])
            source = "client_wall_clock"
        if effective_seconds is None:
            continue
        _update_study_session(
            connection,
            session_id=str(row["id"]),
            effective_seconds=effective_seconds,
            summary_json=_summary_with_backfill(
                summary,
                source=source,
                effective_seconds=effective_seconds,
            ),
        )


def upgrade() -> None:
    connection = op.get_bind()
    _backfill_review_logs(connection)
    _backfill_completed_client_sessions(connection)


def downgrade() -> None:
    pass
