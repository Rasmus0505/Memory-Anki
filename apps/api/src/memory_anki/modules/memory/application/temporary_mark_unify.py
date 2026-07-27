"""Unify FSRS progress across a node group (temporary mark confirm)."""

from __future__ import annotations

from datetime import datetime
from statistics import mean
from typing import Any

from fsrs import State
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.memory.application.node_memory_projection import _clear_due_rollup_cache
from memory_anki.modules.memory.application.wave_policy import SCHEDULE_CALIBRATED
from memory_anki.modules.memory.application.wave_service import (
    assign_node_to_formal_wave,
    remove_node_from_open_waves,
)


def _has_fsrs_progress(row: ReviewNodeState) -> bool:
    if row.stability is None:
        return False
    schedule = str(getattr(row, "schedule_source", None) or "")
    if schedule in {"uninitialized", "content_changed"}:
        return False
    return True


def _avg_datetime(values: list[datetime]) -> datetime | None:
    if not values:
        return None
    timestamps = [dt.timestamp() for dt in values]
    return datetime.fromtimestamp(mean(timestamps))


def unify_fsrs_progress_for_node_groups(
    session: Session,
    *,
    palace_id: int,
    node_uids: list[str],
    operation_id: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Average FSRS fields from nodes that already have progress; write to all.

    If no node in the group has FSRS progress, leave all untouched (new cards).
    """
    uids = [str(uid) for uid in node_uids if str(uid).strip()]
    if not uids:
        return {
            "palace_id": int(palace_id),
            "affected_node_count": 0,
            "source_count": 0,
            "skipped": True,
            "reason": "empty_group",
            "operation_id": operation_id,
        }

    rows = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == int(palace_id),
            ReviewNodeState.node_uid.in_(uids),
        )
        .all()
    }
    sources = [rows[uid] for uid in uids if uid in rows and _has_fsrs_progress(rows[uid])]
    if not sources:
        return {
            "palace_id": int(palace_id),
            "affected_node_count": 0,
            "source_count": 0,
            "skipped": True,
            "reason": "no_existing_fsrs",
            "operation_id": operation_id,
        }

    avg_stability = mean(float(row.stability) for row in sources if row.stability is not None)
    difficulties = [float(row.difficulty) for row in sources if row.difficulty is not None]
    avg_difficulty = mean(difficulties) if difficulties else 5.0
    # State: majority vote among sources; ties -> Review.
    state_votes: dict[int, int] = {}
    for row in sources:
        state_votes[int(row.state)] = state_votes.get(int(row.state), 0) + 1
    avg_state = max(state_votes.items(), key=lambda item: (item[1], item[0] == int(State.Review)))[0]
    last_reviews = [row.last_review_at for row in sources if row.last_review_at is not None]
    avg_last = _avg_datetime(last_reviews)  # type: ignore[arg-type]
    raw_dues = [
        (row.raw_due_at or row.due_at)
        for row in sources
        if (row.raw_due_at or row.due_at) is not None
    ]
    avg_raw = _avg_datetime(raw_dues)  # type: ignore[arg-type]
    if avg_raw is None:
        avg_raw = utc_now_naive()
    desired = mean(float(row.desired_retention or 0.9) for row in sources)
    max_interval = int(round(mean(float(row.maximum_interval or 180) for row in sources)))

    now = utc_now_naive()
    affected = 0
    for uid in uids:
        existing = rows.get(uid)
        if existing is None:
            row = ReviewNodeState(palace_id=int(palace_id), node_uid=uid)
            session.add(row)
            rows[uid] = row
        else:
            row = existing
        remove_node_from_open_waves(session, row)
        row.state = int(avg_state)
        row.step = None if int(avg_state) == int(State.Review) else 0
        row.stability = float(avg_stability)
        row.difficulty = float(avg_difficulty)
        row.last_review_at = avg_last
        row.desired_retention = float(desired)
        row.maximum_interval = int(max_interval)
        assign_node_to_formal_wave(
            session,
            row,
            raw_due_at=avg_raw,
            reason="temporary_mark_unify",
        )
        row.schedule_source = SCHEDULE_CALIBRATED
        row.schedule_reason = "temporary_mark_unify"
        row.updated_at = now
        affected += 1

    session.flush()
    _clear_due_rollup_cache(session)
    if commit:
        session.commit()
    return {
        "palace_id": int(palace_id),
        "affected_node_count": affected,
        "source_count": len(sources),
        "skipped": False,
        "average": {
            "stability": avg_stability,
            "difficulty": avg_difficulty,
            "state": avg_state,
            "raw_due_at": avg_raw.isoformat() if avg_raw else None,
            "last_review_at": avg_last.isoformat() if avg_last else None,
        },
        "operation_id": operation_id,
    }


__all__ = ["unify_fsrs_progress_for_node_groups"]
