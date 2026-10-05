"""Round learning-time writes: live ticks and one-time dwell backfill."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState, StudySession
from memory_anki.modules.memory.api import encounter_focus_seconds_by_palace
from memory_anki.modules.practice.application.round_state_service import (
    _begin_round_write,
    _commit_plan,
    _plan_of,
    _require_operation_id,
)
from memory_anki.modules.practice.domain.learning_time import (
    apply_learning_adds,
    apply_learning_intervals,
    attribute_unassigned_unit_seconds,
    fold_freestyle_segment,
    normalize_learning_time,
    single_palace_weight,
)
from memory_anki.modules.practice.domain.workspace import normalize_workspace


def _parse_utc(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def accumulate_round_learning_time(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    intervals: list[dict[str, Any]] | None = None,
    adds: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Record interval facts, or legacy scalar adds. Duplicate operations do not add twice."""
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None or row is None:
        return early or {}
    plan = _plan_of(row)
    learning = plan.get("learning_time")
    if intervals:
        learning = apply_learning_intervals(learning, intervals)
    if adds:
        learning = apply_learning_adds(learning, adds)
    plan["learning_time"] = learning
    return _commit_plan(session, row, plan, _require_operation_id(operation_id))


def _segments_for_round(session: Session, row: FreestyleRoundState) -> list[dict[str, Any]]:
    started = row.created_at or utc_now_naive()
    window_start = started - timedelta(days=1)
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.started_at >= window_start,
        )
        .all()
    )
    segments: list[dict[str, Any]] = []
    for item in rows:
        try:
            summary = json.loads(item.summary_json or "{}")
        except json.JSONDecodeError:
            continue
        raw = summary.get("scene_segments") if isinstance(summary, dict) else None
        if not isinstance(raw, list):
            continue
        for segment in raw:
            if not isinstance(segment, dict):
                continue
            segment_started = _parse_utc(segment.get("startedAt") or segment.get("started_at"))
            if segment_started is None or segment_started < started:
                continue
            segments.append(segment)
    return segments


def backfill_round_learning_time(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
) -> dict[str, Any]:
    """Copy this round's dwell segments into learning_time once.

    Later calls keep the stored totals. Live ticks after this call are added
    separately so a checkpoint of the same seconds is not counted twice.
    """
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None or row is None:
        return early or {}
    op_id = _require_operation_id(operation_id)
    plan = _plan_of(row)
    folded = normalize_learning_time(plan.get("learning_time"))
    if folded.get("backfilled"):
        payload = _commit_plan(session, row, plan, op_id)
        payload["learning_backfill_applied"] = False
        return payload
    workspace = normalize_workspace(row.workspace)
    for segment in _segments_for_round(session, row):
        folded = fold_freestyle_segment(folded, segment, workspace=workspace)
    weights = encounter_focus_seconds_by_palace(session, row.round_id) or single_palace_weight(plan)
    folded = attribute_unassigned_unit_seconds(folded, weights)
    folded["backfilled"] = True
    plan["learning_time"] = folded
    payload = _commit_plan(session, row, plan, op_id)
    payload["learning_backfill_applied"] = True
    return payload
