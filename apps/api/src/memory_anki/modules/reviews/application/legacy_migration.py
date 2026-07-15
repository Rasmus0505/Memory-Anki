"""Translate legacy palace stages into conservative node-level FSRS state."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState

from .node_memory_service import (
    DEFAULT_MAXIMUM_INTERVAL,
    DEFAULT_RETENTION,
    SCHEDULER_VERSION,
    _tree,
)


def _legacy_anchor(palace: Palace) -> tuple[datetime, int]:
    completed = [row for row in (palace.review_schedules or []) if row.completed]
    if completed:
        latest = max(completed, key=lambda row: (row.review_number, row.completed_at or datetime.min))
        interval = max(0, int(latest.interval_days or 0))
        anchor = latest.completed_at or datetime.combine(latest.scheduled_date, time.min)
        return anchor, interval
    pending = [row for row in (palace.review_schedules or []) if not row.completed]
    if pending:
        first = min(pending, key=lambda row: (row.review_number, row.id))
        anchor = first.scheduled_at or datetime.combine(first.scheduled_date, time.min)
        return anchor - timedelta(days=max(0, int(first.interval_days or 0))), 0
    return palace.created_at or utc_now_naive(), 0


def migrate_legacy_node_states(session: Session, *, palace_id: int | None = None) -> dict[str, int]:
    query = session.query(Palace).filter(Palace.deleted_at.is_(None))
    if palace_id is not None:
        query = query.filter(Palace.id == palace_id)
    created = 0
    skipped = 0
    for palace in query.all():
        root_uid, nodes = _tree(palace)
        if not nodes:
            continue
        anchor, interval_days = _legacy_anchor(palace)
        now = datetime.now(UTC).replace(tzinfo=None)
        due_at = anchor + timedelta(days=max(0, interval_days))
        for uid, node in nodes.items():
            if uid == root_uid:
                continue
            existing = session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid=uid).first()
            if existing is not None:
                skipped += 1
                continue
            state = ReviewNodeState(
                palace_id=palace.id, node_uid=uid, state=2 if interval_days > 0 else 1,
                step=None, stability=float(max(interval_days, 0) or 0.1), difficulty=5.0,
                due_at=due_at, last_review_at=anchor, desired_retention=DEFAULT_RETENTION,
                maximum_interval=DEFAULT_MAXIMUM_INTERVAL, content_fingerprint=node["content_fingerprint"],
                state_source="legacy_estimate", scheduler_version=SCHEDULER_VERSION, parameter_version="legacy-stage-estimate",
                created_at=now, updated_at=now,
            )
            session.add(state)
            created += 1
    session.commit()
    return {"created": created, "skipped": skipped}
