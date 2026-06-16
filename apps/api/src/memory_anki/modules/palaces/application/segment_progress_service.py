from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, PalaceSegment
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    palace_algorithm as resolve_palace_review_algorithm,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_all_pending_review_schedules as rebuild_review_schedule_backlog,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_palace_review_schedules as rebuild_palace_review_schedule_state,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_segment_review_schedules as rebuild_segment_review_schedule_state,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_config_value,
    normalize_algorithm,
)

from .review_progress_datetime import parse_progress_datetime


def adjust_segment_review_progress(
    session: Session,
    segment: PalaceSegment,
    payload: dict[str, Any],
) -> PalaceSegment:
    completed_at = parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    rebuild_segment_review_progress(
        session,
        segment,
        completed_count=int(payload.get("completed_count", 0)),
        completed_review_number=completed_review_number,
        completed_at=completed_at,
    )
    session.commit()
    session.refresh(segment)
    return segment


def adjust_palace_default_segment_review_progress(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
) -> Palace:
    algorithm = resolve_palace_review_algorithm(
        session,
        palace,
        default_algorithm=normalize_algorithm(get_config_value(session, "default_algorithm")),
    )
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    completed_count = max(0, min(int(payload.get("completed_count", 0)), total))
    completed_at = parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    rebuild_palace_default_segment_progress(
        session,
        palace,
        completed_count=completed_count,
        completed_review_number=completed_review_number,
        completed_at=completed_at,
        preserve_existing_progress=False,
    )
    session.commit()
    session.refresh(palace)
    return palace


def repair_all_review_stage_progress(session: Session) -> dict[str, Any]:
    return rebuild_review_schedule_backlog(session)


def rebuild_all_pending_review_schedules(
    session: Session,
    *,
    algorithm_override: str | None = None,
) -> dict[str, Any]:
    return rebuild_review_schedule_backlog(
        session,
        algorithm_override=algorithm_override,
    )


def rebuild_palace_default_segment_progress(
    session: Session,
    palace: Palace,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    fallback_completed_count: int | None = None,
    preserve_existing_progress: bool = True,
    algorithm_override: str | None = None,
) -> None:
    rebuild_palace_review_schedule_state(
        session,
        palace,
        completed_count=completed_count,
        completed_review_number=completed_review_number,
        completed_at=completed_at,
        fallback_completed_count=fallback_completed_count,
        preserve_existing_progress=preserve_existing_progress,
        algorithm_override=algorithm_override,
    )


def rebuild_segment_review_progress(
    session: Session,
    segment: PalaceSegment,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    algorithm_override: str | None = None,
) -> None:
    rebuild_segment_review_schedule_state(
        session,
        segment,
        completed_count=completed_count,
        completed_review_number=completed_review_number,
        completed_at=completed_at,
        algorithm_override=algorithm_override,
    )
