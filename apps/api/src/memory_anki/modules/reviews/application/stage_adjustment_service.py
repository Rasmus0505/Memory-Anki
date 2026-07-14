from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewSchedule,
    ReviewStageAdjustment,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count,
    rebuild_palace_review_schedules,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
    schedule_display_datetime,
)


class ReviewStageAdjustmentNotFoundError(Exception):
    pass


class ReviewStageAdjustmentConflictError(Exception):
    pass


def _active_palace(session: Session, palace_id: int) -> Palace:
    palace = (
        session.query(Palace)
        .filter(Palace.id == palace_id, Palace.deleted_at.is_(None))
        .first()
    )
    if palace is None:
        raise ReviewStageAdjustmentNotFoundError
    return palace


def _completed_count(palace: Palace, total: int) -> int:
    return infer_completed_stage_count(
        total=total,
        schedules=list(palace.review_schedules or []),
        mastered=palace.mastered,
    )


def _validate_target(target_completed_count: int, total: int) -> int:
    if target_completed_count < 0 or target_completed_count > total:
        raise ValueError(f"目标阶段数必须在 0 到 {total} 之间。")
    return target_completed_count


def _direction(current: int, target: int) -> str:
    if target == 0 and current > 0:
        return "reset"
    if target > current:
        return "forward"
    if target < current:
        return "backward"
    return "unchanged"


def _serialize_preview(
    session: Session,
    palace: Palace,
    *,
    labels: list[str],
    previous_completed_count: int,
    target_completed_count: int,
) -> dict[str, Any]:
    schedules = sorted(
        session.query(ReviewSchedule)
        .filter(ReviewSchedule.palace_id == palace.id)
        .all(),
        key=lambda item: (item.review_number, item.id),
    )
    next_schedule = next((schedule for schedule in schedules if not schedule.completed), None)
    next_display_at = (
        schedule_display_datetime(next_schedule, palace, session)
        if next_schedule is not None
        else None
    )
    preserved_count = min(previous_completed_count, target_completed_count)
    return {
        "ok": True,
        "palace_id": palace.id,
        "palace_title": palace.title,
        "previous_completed_count": previous_completed_count,
        "target_completed_count": target_completed_count,
        "total_stage_count": len(labels),
        "direction": _direction(previous_completed_count, target_completed_count),
        "current_stage_label": (
            labels[previous_completed_count - 1] if previous_completed_count > 0 else None
        ),
        "target_stage_label": (
            labels[target_completed_count - 1] if target_completed_count > 0 else None
        ),
        "preserved_stage_labels": labels[:preserved_count],
        "added_stage_labels": labels[previous_completed_count:target_completed_count],
        "removed_stage_labels": labels[target_completed_count:previous_completed_count],
        "next_stage_label": (
            labels[target_completed_count] if target_completed_count < len(labels) else None
        ),
        "next_review_at": next_display_at.isoformat(timespec="minutes") if next_display_at else None,
        "mastered": target_completed_count >= len(labels),
        "needs_practice": bool(palace.needs_practice),
    }


def _apply_adjustment_state(
    session: Session,
    palace: Palace,
    *,
    total_stage_count: int,
    target_completed_count: int,
    completed_at: datetime | None,
    needs_practice: bool,
) -> None:
    rebuild_palace_review_schedules(
        session,
        palace,
        completed_count=target_completed_count,
        completed_at=completed_at if target_completed_count > 0 else None,
        preserve_existing_progress=False,
    )
    palace.mastered = target_completed_count >= total_stage_count
    palace.needs_practice = bool(needs_practice)
    palace.updated_at = utc_now_naive()
    session.flush()


def preview_review_stage_adjustment(
    session: Session,
    palace_id: int,
    *,
    target_completed_count: int,
    completed_at: datetime | None,
    needs_practice: bool,
) -> dict[str, Any]:
    palace = _active_palace(session, palace_id)
    labels = get_algorithm_stage_labels(session)
    target = _validate_target(target_completed_count, len(labels))
    current = _completed_count(palace, len(labels))
    savepoint = session.begin_nested()
    try:
        _apply_adjustment_state(
            session,
            palace,
            total_stage_count=len(labels),
            target_completed_count=target,
            completed_at=completed_at,
            needs_practice=needs_practice,
        )
        response = _serialize_preview(
            session,
            palace,
            labels=labels,
            previous_completed_count=current,
            target_completed_count=target,
        )
    finally:
        savepoint.rollback()
        session.expire_all()
    return response


def apply_review_stage_adjustment(
    session: Session,
    palace_id: int,
    *,
    target_completed_count: int,
    completed_at: datetime | None,
    needs_practice: bool,
    expected_completed_count: int,
    note: str,
) -> dict[str, Any]:
    palace = _active_palace(session, palace_id)
    labels = get_algorithm_stage_labels(session)
    target = _validate_target(target_completed_count, len(labels))
    current = _completed_count(palace, len(labels))
    if current != expected_completed_count:
        raise ReviewStageAdjustmentConflictError

    _apply_adjustment_state(
        session,
        palace,
        total_stage_count=len(labels),
        target_completed_count=target,
        completed_at=completed_at,
        needs_practice=needs_practice,
    )
    session.add(
        ReviewStageAdjustment(
            palace_id=palace.id,
            previous_completed_count=current,
            target_completed_count=target,
            completed_at=completed_at if target > 0 else None,
            needs_practice=bool(needs_practice),
            note=note.strip()[:2000],
        )
    )
    session.flush()
    return _serialize_preview(
        session,
        palace,
        labels=labels,
        previous_completed_count=current,
        target_completed_count=target,
    )
