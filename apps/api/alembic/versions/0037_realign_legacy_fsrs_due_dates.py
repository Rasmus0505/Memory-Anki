"""realign legacy FSRS node due dates with pending review schedules

Revision ID: 0037_realign_legacy_fsrs_due
Revises: 0036_fsrs_rating_check
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import sqlalchemy as sa
from alembic import op

revision = "0037_realign_legacy_fsrs_due"
down_revision = "0036_fsrs_rating_check"
branch_labels = None
depends_on = None


def _as_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _as_time(value: object, fallback: time) -> time:
    raw = str(value or "").strip()
    try:
        hour, minute = raw.split(":", 1)
        return time(int(hour), int(minute))
    except (TypeError, ValueError):
        return fallback


def _display_due(row: sa.RowMapping, sleep_review_time: time) -> datetime | None:
    scheduled_at = _as_datetime(row["scheduled_at"])
    if scheduled_at is not None:
        return scheduled_at.replace(second=0, microsecond=0)
    scheduled_date = _as_datetime(row["scheduled_date"])
    if scheduled_date is None:
        return None
    created_at = _as_datetime(row["created_at"])
    base_time = created_at.time().replace(second=0, microsecond=0) if created_at else time(0, 0)
    review_type = str(row["review_type"] or "")
    if review_type == "sleep":
        display_time = sleep_review_time
    elif review_type == "1h":
        display_time = (datetime.combine(scheduled_date.date(), base_time) + timedelta(hours=1)).time()
    else:
        display_time = base_time
    return datetime.combine(scheduled_date.date(), display_time)


def upgrade() -> None:
    bind = op.get_bind()
    sleep_value = bind.execute(
        sa.text("SELECT value FROM config WHERE key = 'sleep_review_time' LIMIT 1")
    ).scalar_one_or_none()
    sleep_review_time = _as_time(sleep_value, time(22, 0))
    rows = bind.execute(
        sa.text(
            """
            SELECT rs.palace_id, rs.scheduled_date, rs.scheduled_at,
                   rs.review_type, p.created_at
            FROM review_schedules rs
            JOIN palaces p ON p.id = rs.palace_id
            WHERE rs.completed = 0 AND p.deleted_at IS NULL
            ORDER BY rs.palace_id, rs.review_number, rs.id
            """
        )
    ).mappings()
    first_pending: dict[int, sa.RowMapping] = {}
    for row in rows:
        first_pending.setdefault(int(row["palace_id"]), row)
    now = datetime.now().replace(microsecond=0)
    for palace_id, row in first_pending.items():
        due_at = _display_due(row, sleep_review_time)
        if due_at is None:
            continue
        bind.execute(
            sa.text(
                """
                UPDATE review_node_states
                SET due_at = :due_at, updated_at = :updated_at
                WHERE palace_id = :palace_id AND state_source = 'legacy_estimate'
                """
            ),
            {"due_at": due_at, "updated_at": now, "palace_id": palace_id},
        )


def downgrade() -> None:
    # The previous inferred dates were incorrect and cannot be restored safely.
    pass
