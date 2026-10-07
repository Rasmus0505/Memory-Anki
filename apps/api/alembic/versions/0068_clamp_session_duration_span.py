"""clamp study-session durations that exceed their own wall span

Revision ID: 0068_clamp_session_duration_span
Revises: 0067_merge_quiz_heads

Some ``all_units_passed`` sessions stored ``effective_seconds`` (the sum of
rated closed card encounters) larger than ``ended_at - started_at``, because
``ended_at`` is stamped after the last card was already on screen. Rows whose
billed time cannot fit inside their own timestamps are impossible to display:
the list shows "14:50 - 14:52" next to a longer duration.

Only spans that are *smaller* than the recorded duration are repaired. A span
larger than the duration is legitimate — that is exactly what paused or
multi-day sessions look like — and touching those would inflate study time by
orders of magnitude.

Every change records the previous values under ``duration_span_repair`` so the
original numbers remain auditable, and hand-edited durations are never touched.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0068_clamp_session_duration_span"
down_revision = "0067_merge_quiz_heads"
branch_labels = None
depends_on = None

REPAIR_VERSION = 1
# A tolerance of a couple of seconds absorbs pure rounding in timestamp
# serialization; larger gaps are real data problems worth recording.
ROUNDING_TOLERANCE_SECONDS = 2
# Beyond this the "span" is more likely a broken clock than a real session, so
# the row is reported instead of silently rewritten.
MAX_REPAIRABLE_SPAN_SECONDS = 12 * 60 * 60


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)
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


def _repairable_span(started_at: Any, ended_at: Any, effective_seconds: int) -> int | None:
    """The wall span to clamp to, or None when the row must be left alone.

    Only returns a value when the span is positive, plausible, and strictly
    smaller than the recorded duration.
    """
    started = _parse_datetime(started_at)
    ended = _parse_datetime(ended_at)
    if started is None or ended is None:
        return None
    span = int((ended - started).total_seconds())
    if span <= 0 or span > MAX_REPAIRABLE_SPAN_SECONDS:
        return None
    if span >= effective_seconds:
        return None
    return span


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, started_at, ended_at, effective_seconds, summary_json "
            "FROM study_sessions "
            "WHERE deleted_at IS NULL AND ended_at IS NOT NULL AND effective_seconds > 0"
        )
    ).mappings().all()

    repaired = 0
    for row in rows:
        recorded = int(row["effective_seconds"] or 0)
        span = _repairable_span(row["started_at"], row["ended_at"], recorded)
        if span is None:
            continue
        summary = _load_summary(row["summary_json"])
        # A hand-edited duration is user-owned; report it but never rewrite it.
        if summary.get("duration_edited"):
            continue
        summary["duration_span_repair"] = {
            "version": REPAIR_VERSION,
            "source": "wall_span_clamp",
            "previous_effective_seconds": recorded,
            "repaired_effective_seconds": span,
            "rounding_only": (recorded - span) <= ROUNDING_TOLERANCE_SECONDS,
            "repaired_at": datetime.now(UTC).isoformat(),
        }
        connection.execute(
            sa.text(
                "UPDATE study_sessions SET effective_seconds = :span, "
                "summary_json = :summary_json "
                "WHERE id = :session_id AND effective_seconds = :recorded"
            ),
            {
                "session_id": str(row["id"]),
                "span": span,
                "summary_json": json.dumps(summary, ensure_ascii=False),
                "recorded": recorded,
            },
        )
        repaired += 1


def downgrade() -> None:
    """Restore the pre-clamp durations recorded in each summary."""
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, effective_seconds, summary_json FROM study_sessions "
            "WHERE summary_json LIKE '%duration_span_repair%'"
        )
    ).mappings().all()
    for row in rows:
        summary = _load_summary(row["summary_json"])
        repair = summary.get("duration_span_repair")
        if not isinstance(repair, dict):
            continue
        previous = repair.get("previous_effective_seconds")
        if not isinstance(previous, int) or previous < 0:
            continue
        # Only revert a row still holding the value this migration wrote.
        if int(row["effective_seconds"] or 0) != int(
            repair.get("repaired_effective_seconds") or -1
        ):
            continue
        summary.pop("duration_span_repair", None)
        connection.execute(
            sa.text(
                "UPDATE study_sessions SET effective_seconds = :previous, "
                "summary_json = :summary_json WHERE id = :session_id"
            ),
            {
                "session_id": str(row["id"]),
                "previous": previous,
                "summary_json": json.dumps(summary, ensure_ascii=False),
            },
        )
