from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewLog,
    PalaceSegmentReviewSchedule,
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    cleanup_segment_node_uids,
    collect_doc_nodes_with_descendants,
    normalize_segment_node_uids,
    parse_segment_node_uids,
    remaining_unclaimed_node_uids,
    serialize_segment_node_uids,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_review_schedule,
    get_algorithm_intervals,
    get_algorithm_stage_labels,
    get_config_value,
    get_initial_same_day_slot_count,
    is_schedule_due,
    normalize_algorithm,
    resolve_interval_from_base_date,
    schedule_display_datetime,
)

SEGMENT_COLOR_PALETTE = [
    "#14b8a6",
    "#f97316",
    "#3b82f6",
    "#eab308",
    "#ec4899",
    "#8b5cf6",
]


def ensure_segment_schema() -> None:
    from memory_anki.infrastructure.db.models import engine

    table_columns = {
        "session_progress": (
            ("palace_segment_id", "INTEGER"),
            ("palace_segment_review_schedule_id", "INTEGER"),
        ),
        "time_records": (
            ("palace_segment_id", "INTEGER"),
        ),
        "review_schedules": (
            ("scheduled_at", "DATETIME"),
            ("completed_at", "DATETIME"),
        ),
        "palace_segment_review_schedules": (
            ("scheduled_at", "DATETIME"),
            ("completed_at", "DATETIME"),
        ),
    }
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "palace_segments" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_id INTEGER NOT NULL,
                    name VARCHAR(200) NOT NULL DEFAULT '',
                    color VARCHAR(24) NOT NULL DEFAULT '#14b8a6',
                    node_uids_json TEXT DEFAULT '[]',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    sort_order INTEGER DEFAULT 0,
                    FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
                )
                """
            )
        if "palace_segment_review_schedules" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segment_review_schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_segment_id INTEGER NOT NULL,
                    scheduled_date DATE NOT NULL,
                    scheduled_at DATETIME NULL,
                    interval_days INTEGER DEFAULT 0,
                    algorithm_used VARCHAR(30) DEFAULT 'ebbinghaus',
                    completed BOOLEAN DEFAULT 0,
                    completed_at DATETIME NULL,
                    review_number INTEGER DEFAULT 0,
                    review_type VARCHAR(20) DEFAULT 'standard',
                    anchor_date DATE NULL,
                    FOREIGN KEY(palace_segment_id) REFERENCES palace_segments(id) ON DELETE CASCADE
                )
                """
            )
        if "palace_segment_review_logs" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segment_review_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_segment_id INTEGER NOT NULL,
                    review_date DATE DEFAULT CURRENT_DATE,
                    score INTEGER DEFAULT 0,
                    review_mode VARCHAR(20) DEFAULT 'flashcard',
                    duration_seconds INTEGER DEFAULT 0,
                    FOREIGN KEY(palace_segment_id) REFERENCES palace_segments(id) ON DELETE CASCADE
                )
                """
            )

        for table_name, columns in table_columns.items():
            existing = {
                row[1]
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            }
            for column_name, column_type in columns:
                if column_name not in existing:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    )

        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_segments_palace_sort "
            "ON palace_segments (palace_id, sort_order)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_segment_review_schedule_segment "
            "ON palace_segment_review_schedules (palace_segment_id, completed, review_number)"
        )


def _next_segment_name(palace: Palace) -> str:
    return f"第 {len(palace.segments) + 1} 部分"


def _default_segment_created_at(palace: Palace) -> datetime:
    if not palace.segments and palace.created_at:
        return palace.created_at
    return utc_now_naive()


def _get_segment_algorithm(session: Session, segment: PalaceSegment) -> str:
    return normalize_algorithm(get_config_value(session, "default_algorithm"))


def _get_segment_anchor_date(segment: PalaceSegment) -> date:
    if segment.created_at:
        return segment.created_at.date()
    return date.today()


def _schedule_display_datetime_for_anchor(
    *,
    scheduled_date: date | None,
    scheduled_at: datetime | None = None,
    review_type: str | None,
    anchor_datetime: datetime | None,
    session: Session,
) -> datetime | None:
    if scheduled_at:
        return scheduled_at.replace(second=0, microsecond=0)
    if not scheduled_date:
        return None

    base_time = (
        anchor_datetime.time().replace(second=0, microsecond=0)
        if anchor_datetime
        else time(0, 0)
    )

    if review_type == "sleep":
        raw_sleep_time = get_config_value(session, "sleep_review_time") or "22:00"
        try:
            hour_str, minute_str = raw_sleep_time.split(":", 1)
            display_time = time(int(hour_str), int(minute_str))
        except (ValueError, TypeError):
            display_time = time(22, 0)
    elif review_type == "1h":
        display_time = (
            datetime.combine(scheduled_date, base_time) + timedelta(hours=1)
        ).time().replace(second=0, microsecond=0)
    else:
        display_time = base_time

    return datetime.combine(scheduled_date, display_time)


def get_segment_schedule_display_datetime(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
) -> datetime | None:
    if schedule is None:
        return None
    return _schedule_display_datetime_for_anchor(
        scheduled_date=schedule.scheduled_date,
        scheduled_at=schedule.scheduled_at,
        review_type=schedule.review_type,
        anchor_datetime=(
            segment.created_at
            or (segment.palace.created_at if segment.palace else None)
        ),
        session=session,
    )


def is_segment_schedule_due(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed:
        return False
    due_at = get_segment_schedule_display_datetime(session, segment, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


def is_segment_schedule_overdue(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed:
        return False
    due_at = get_segment_schedule_display_datetime(session, segment, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at.date() < current.date() and due_at <= current


def build_virtual_default_segment_timing(
    palace: Palace,
    *,
    session: Session,
    review_stage_total: int,
    review_stage_completed: int,
) -> dict[str, Any]:
    pending_schedules = sorted(
        [schedule for schedule in (palace.review_schedules or []) if not schedule.completed],
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    next_schedule = pending_schedules[0] if pending_schedules else None
    if next_schedule is not None:
        next_review_at = schedule_display_datetime(next_schedule, palace, session)
        has_due_review = bool(next_review_at and is_schedule_due(next_schedule, palace, session))
        return {
            "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
            "has_due_review": has_due_review,
            "current_review_schedule_id": next_schedule.id,
        }

    current_algorithm = next(
        (
            normalize_algorithm(schedule.algorithm_used)
            for schedule in (palace.review_schedules or [])
            if schedule.algorithm_used
        ),
        normalize_algorithm(get_config_value(session, "default_algorithm")),
    )
    intervals = get_algorithm_intervals(session, current_algorithm)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]

    total = len(intervals)
    completed = max(0, min(review_stage_completed, total))
    if completed >= total:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
        }

    next_interval_value = intervals[completed]
    _, scheduled_date, review_type, _ = resolve_interval_from_base_date(
        next_interval_value,
        (palace.created_at.date() if palace.created_at else date.today()),
        current_algorithm,
    )
    next_review_at = _schedule_display_datetime_for_anchor(
        scheduled_date=scheduled_date,
        scheduled_at=None,
        review_type=review_type,
        anchor_datetime=palace.created_at or palace.updated_at,
        session=session,
    )
    has_due_review = bool(next_review_at and next_review_at <= datetime.now())
    return {
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": None,
    }


def ensure_segment_schedule_model(session: Session, segment: PalaceSegment) -> None:
    schedules = sorted(
        list(segment.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    if schedules:
        return
    algorithm = _get_segment_algorithm(session, segment)
    intervals = get_algorithm_intervals(session, algorithm)
    if not intervals:
        return
    anchor = _get_segment_anchor_date(segment)
    slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    for review_number in range(min(slot_count, len(intervals))):
        schedule = create_review_schedule(
            session,
            palace_id=segment.palace_id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
        if schedule is None:
            continue
        segment_schedule = PalaceSegmentReviewSchedule(
            palace_segment_id=segment.id,
            scheduled_date=schedule.scheduled_date,
            interval_days=schedule.interval_days,
            algorithm_used=schedule.algorithm_used,
            completed=schedule.completed,
            completed_at=schedule.completed_at,
            review_number=schedule.review_number,
            review_type=schedule.review_type,
            anchor_date=schedule.anchor_date,
            scheduled_at=schedule.scheduled_at,
        )
        session.add(segment_schedule)
        session.expunge(schedule)
    session.flush()


def _segment_progress(
    session: Session,
    segment: PalaceSegment,
) -> tuple[int, int, float]:
    algorithm = _get_segment_algorithm(session, segment)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed_count = _infer_completed_stage_count(
        total=total,
        schedules=segment.review_schedules or [],
    )
    return total, completed_count, completed_count / total


def _serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def _parse_progress_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0)


def _segment_algorithm(session: Session, segment: PalaceSegment) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (segment.review_schedules or [])
            if item.algorithm_used
        ),
        _get_segment_algorithm(session, segment),
    )


def _palace_algorithm(session: Session, palace: Palace) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (palace.review_schedules or [])
            if item.algorithm_used
        ),
        normalize_algorithm(get_config_value(session, "default_algorithm")),
    )


def _palace_anchor_date(palace: Palace) -> date:
    for schedule in palace.review_schedules or []:
        if schedule.anchor_date:
            return schedule.anchor_date
    if palace.created_at:
        return palace.created_at.date()
    return date.today()


def _palace_stage_completed_count(session: Session, palace: Palace, total: int) -> int:
    return _infer_completed_stage_count(
        total=total,
        schedules=palace.review_schedules or [],
        mastered=palace.mastered,
    )


def palace_stage_progress(session: Session, palace: Palace) -> tuple[int, int, float]:
    algorithm = _palace_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, algorithm)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed = _palace_stage_completed_count(session, palace, total)
    return total, completed, completed / total


def _review_stages_json(
    *,
    stage_labels: list[str],
    schedules: dict[int, Any],
    completed_count: int,
    scheduled_at_for: Callable[[Any | None], datetime | None],
) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    for index, label in enumerate(stage_labels):
        schedule = schedules.get(index)
        completed = index < completed_count
        stages.append(
            {
                "review_number": index,
                "label": label,
                "completed": completed,
                "completed_at": _serialize_stage_datetime(
                    schedule.completed_at if completed and schedule else None
                ),
                "scheduled_at": _serialize_stage_datetime(scheduled_at_for(schedule)),
            }
        )
    return stages


def segment_review_stages_json(
    session: Session,
    segment: PalaceSegment,
    stage_labels: list[str],
) -> list[dict[str, Any]]:
    schedules = {
        schedule.review_number: schedule
        for schedule in sorted(segment.review_schedules or [], key=lambda item: item.id)
    }
    _, completed_count, _ = _segment_progress(session, segment)
    return _review_stages_json(
        stage_labels=stage_labels,
        schedules=schedules,
        completed_count=completed_count,
        scheduled_at_for=lambda schedule: get_segment_schedule_display_datetime(
            session,
            segment,
            schedule,
        ),
    )


def palace_review_stages_json(
    session: Session,
    palace: Palace,
    stage_labels: list[str],
) -> list[dict[str, Any]]:
    schedules = {
        schedule.review_number: schedule
        for schedule in sorted(palace.review_schedules or [], key=lambda item: item.id)
    }
    completed_count = _palace_stage_completed_count(session, palace, len(stage_labels))
    return _review_stages_json(
        stage_labels=stage_labels,
        schedules=schedules,
        completed_count=completed_count,
        scheduled_at_for=lambda schedule: (
            schedule_display_datetime(schedule, palace, session) if schedule else None
        ),
    )


def _copy_segment_schedule(
    segment: PalaceSegment,
    schedule: ReviewSchedule,
    *,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceSegmentReviewSchedule:
    return PalaceSegmentReviewSchedule(
        palace_segment_id=segment.id,
        scheduled_date=schedule.scheduled_date,
        scheduled_at=schedule.scheduled_at,
        interval_days=schedule.interval_days,
        algorithm_used=schedule.algorithm_used,
        completed=completed,
        completed_at=completed_at,
        review_number=schedule.review_number,
        review_type=schedule.review_type,
        anchor_date=schedule.anchor_date,
    )


def _coerce_stage_completed_at(
    value: datetime | None,
    *,
    fallback: datetime | None = None,
) -> datetime:
    target = value or fallback or datetime.now()
    return target.replace(second=0, microsecond=0)


def _infer_completed_stage_count(
    *,
    total: int,
    schedules: list[Any],
    mastered: bool = False,
    fallback_completed_count: int | None = None,
) -> int:
    if total <= 0:
        return 0

    completed_numbers = {
        int(schedule.review_number)
        for schedule in schedules
        if getattr(schedule, "completed", False)
    }
    pending_numbers = sorted(
        {
            int(schedule.review_number)
            for schedule in schedules
            if not getattr(schedule, "completed", False)
        }
    )

    completed_count = 0
    while completed_count < total and completed_count in completed_numbers:
        completed_count += 1

    if pending_numbers:
        completed_count = max(completed_count, min(pending_numbers[0], total))
    if fallback_completed_count is not None:
        completed_count = max(completed_count, min(fallback_completed_count, total))
    if mastered and total > 0:
        completed_count = total

    return max(0, min(completed_count, total))


def _schedule_display_or_completed_at(
    schedule: Any,
    *,
    scheduled_at_for: Callable[[Any], datetime | None],
) -> datetime | None:
    return (
        getattr(schedule, "completed_at", None)
        or getattr(schedule, "scheduled_at", None)
        or scheduled_at_for(schedule)
    )


def _collect_completed_stage_times(
    *,
    schedules: list[Any],
    completed_count: int,
) -> dict[int, datetime]:
    completed_at_by_stage: dict[int, datetime] = {}
    for review_number in range(completed_count):
        matching = [
            schedule
            for schedule in schedules
            if int(schedule.review_number) == review_number
        ]
        completed_schedule = next(
            (schedule for schedule in matching if getattr(schedule, "completed", False)),
            None,
        )
        if completed_schedule is None:
            continue
        completed_at_by_stage[review_number] = _coerce_stage_completed_at(
            getattr(completed_schedule, "completed_at", None)
        )
    return completed_at_by_stage


def _target_pending_review_numbers(
    *,
    completed_count: int,
    total: int,
    initial_slot_count: int,
) -> list[int]:
    if completed_count >= total:
        return []
    if completed_count < initial_slot_count:
        return list(range(completed_count, min(initial_slot_count, total)))
    return [completed_count]


def _rebuild_palace_review_schedules(
    session: Session,
    palace: Palace,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    fallback_completed_count: int | None = None,
    preserve_existing_progress: bool = True,
) -> None:
    algorithm = _palace_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = _palace_anchor_date(palace)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    existing_schedules = sorted(
        list(palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )

    if preserve_existing_progress and fallback_completed_count is None:
        fallback_completed_count = _infer_completed_stage_count(
            total=total,
            schedules=existing_schedules,
            mastered=palace.mastered,
        )

    effective_completed_count = safe_completed_count
    if preserve_existing_progress and fallback_completed_count is not None:
        effective_completed_count = max(
            safe_completed_count,
            min(fallback_completed_count, total),
        )
    completed_at_by_stage = _collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=effective_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < effective_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = _coerce_stage_completed_at(completed_at)
    elif completed_at is not None and effective_completed_count > 0:
        normalized_completed_at = _coerce_stage_completed_at(completed_at)
        completed_at_by_stage[effective_completed_count - 1] = normalized_completed_at
        for review_number in range(effective_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(ReviewSchedule).filter_by(palace_id=palace.id).delete(
        synchronize_session=False
    )
    session.flush()
    session.expire(palace, ['review_schedules'])

    previous_completed_at: datetime | None = None
    for review_number in range(effective_completed_count):
        stage_completed_at = _coerce_stage_completed_at(
            completed_at_by_stage.get(review_number),
            fallback=previous_completed_at,
        )
        base_datetime = previous_completed_at if review_number >= initial_slot_count else None
        create_review_schedule(
            session=session,
            palace_id=palace.id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        )
        previous_completed_at = stage_completed_at

    palace.mastered = effective_completed_count >= total and total > 0
    if not palace.mastered:
        for review_number in _target_pending_review_numbers(
            completed_count=effective_completed_count,
            total=total,
            initial_slot_count=initial_slot_count,
        ):
            base_datetime = previous_completed_at if review_number >= initial_slot_count else None
            create_review_schedule(
                session=session,
                palace_id=palace.id,
                review_number=review_number,
                algorithm=algorithm,
                base_date=anchor if base_datetime is None else base_datetime.date(),
                anchor_date=anchor,
                base_datetime=base_datetime,
                completed=False,
            )

    session.flush()


def _rebuild_segment_review_schedules(
    session: Session,
    segment: PalaceSegment,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
) -> None:
    algorithm = _segment_algorithm(session, segment)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = _get_segment_anchor_date(segment)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    existing_schedules = sorted(
        list(segment.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    completed_at_by_stage = _collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=safe_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < safe_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = _coerce_stage_completed_at(completed_at)
    elif completed_at is not None and safe_completed_count > 0:
        normalized_completed_at = _coerce_stage_completed_at(completed_at)
        completed_at_by_stage[safe_completed_count - 1] = normalized_completed_at
        for review_number in range(safe_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(PalaceSegmentReviewSchedule).filter_by(
        palace_segment_id=segment.id
    ).delete(synchronize_session=False)
    session.flush()
    session.expire(segment, ['review_schedules'])

    previous_completed_at: datetime | None = None
    for review_number in range(safe_completed_count):
        stage_completed_at = _coerce_stage_completed_at(
            completed_at_by_stage.get(review_number),
            fallback=previous_completed_at,
        )
        base_datetime = previous_completed_at if review_number >= initial_slot_count else None
        schedule = create_review_schedule(
            session=session,
            palace_id=segment.palace_id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        )
        if schedule is not None:
            session.add(
                _copy_segment_schedule(
                    segment,
                    schedule,
                    completed=True,
                    completed_at=stage_completed_at,
                )
            )
            session.expunge(schedule)
        previous_completed_at = stage_completed_at

    for review_number in _target_pending_review_numbers(
        completed_count=safe_completed_count,
        total=total,
        initial_slot_count=initial_slot_count,
    ):
        base_datetime = previous_completed_at if review_number >= initial_slot_count else None
        schedule = create_review_schedule(
            session=session,
            palace_id=segment.palace_id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=False,
        )
        if schedule is not None:
            session.add(
                _copy_segment_schedule(
                    segment,
                    schedule,
                    completed=False,
                    completed_at=None,
                )
            )
            session.expunge(schedule)
    session.flush()


def adjust_segment_review_progress(
    session: Session,
    segment: PalaceSegment,
    payload: dict[str, Any],
) -> PalaceSegment:
    completed_at = _parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    _rebuild_segment_review_schedules(
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
    algorithm = _palace_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    completed_count = max(0, min(int(payload.get("completed_count", 0)), total))
    completed_at = _parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    _rebuild_palace_review_schedules(
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
    palace_count = 0
    segment_count = 0

    palaces = session.query(Palace).all()
    for palace in palaces:
        algorithm = _palace_algorithm(session, palace)
        total = len(get_algorithm_intervals(session, algorithm))
        review_logs = [
            log
            for log in (palace.review_logs or [])
            if getattr(log, "review_mode", "") == "review"
        ]
        schedule_completed_count = _infer_completed_stage_count(
            total=total,
            schedules=palace.review_schedules or [],
            mastered=palace.mastered,
        )
        fallback_completed_count = (
            schedule_completed_count
            if palace.review_schedules
            else max(len(review_logs), schedule_completed_count)
        )
        _rebuild_palace_review_schedules(
            session,
            palace,
            completed_count=fallback_completed_count,
            fallback_completed_count=fallback_completed_count,
        )
        palace_count += 1

    segments = session.query(PalaceSegment).all()
    for segment in segments:
        algorithm = _segment_algorithm(session, segment)
        total = len(get_algorithm_intervals(session, algorithm))
        schedule_completed_count = _infer_completed_stage_count(
            total=total,
            schedules=segment.review_schedules or [],
        )
        fallback_completed_count = (
            schedule_completed_count
            if segment.review_schedules
            else max(len(segment.review_logs or []), schedule_completed_count)
        )
        _rebuild_segment_review_schedules(
            session,
            segment,
            completed_count=fallback_completed_count,
        )
        segment_count += 1

    session.commit()
    return {
        "palace_count": palace_count,
        "segment_count": segment_count,
    }


def estimate_segment_review_seconds(segment: PalaceSegment) -> int:
    logs = segment.review_logs or []
    total_duration = sum(max(0, int(log.duration_seconds or 0)) for log in logs)
    node_count = len(parse_segment_node_uids(segment.node_uids_json))
    if total_duration > 0 and logs:
        return max(60, round(total_duration / len(logs)))
    if node_count > 0:
        return max(60, node_count * 45)
    return 0


def estimate_palace_review_seconds(palace: Palace) -> int:
    logs = [
        log
        for log in (palace.review_logs or [])
        if getattr(log, "review_mode", "") == "review"
    ]
    total_duration = sum(max(0, int(log.duration_seconds or 0)) for log in logs)
    if total_duration > 0 and logs:
        return max(60, round(total_duration / len(logs)))
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    node_count = len(descendants)
    if node_count > 0:
        return max(60, node_count * 45)
    return 0


def segment_summary_json(session: Session, segment: PalaceSegment) -> dict[str, Any]:
    ensure_segment_schedule_model(session, segment)
    cleanup_segment_node_uids(session, segment.palace)
    schedules = [item for item in segment.review_schedules if not item.completed]
    next_schedule = min(schedules, key=lambda item: (item.review_number, item.id)) if schedules else None
    next_review_at = get_segment_schedule_display_datetime(session, segment, next_schedule)
    total, completed, progress = _segment_progress(session, segment)
    algorithm = next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (segment.review_schedules or [])
            if item.algorithm_used
        ),
        normalize_algorithm(get_config_value(session, "default_algorithm")),
    )
    display_name = get_segment_display_name(segment.palace, segment)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
    return {
        "id": segment.id,
        "palace_id": segment.palace_id,
        "name": segment.name,
        "display_name": display_name,
        "color": segment.color,
        "created_at": segment.created_at.isoformat() if segment.created_at else None,
        "sort_order": segment.sort_order,
        "node_uids": parse_segment_node_uids(segment.node_uids_json),
        "node_count": len(parse_segment_node_uids(segment.node_uids_json)),
        "estimated_review_seconds": estimate_segment_review_seconds(segment),
        "review_stage_total": total,
        "review_stage_completed": completed,
        "review_stage_progress": progress,
        "stage_labels": stage_labels,
        "review_stages": segment_review_stages_json(session, segment, stage_labels),
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": is_segment_schedule_due(session, segment, next_schedule),
        "current_review_schedule_id": next_schedule.id if next_schedule else None,
        "is_empty": len(parse_segment_node_uids(segment.node_uids_json)) == 0,
    }


def build_virtual_default_segment_summary(
    palace: Palace,
    *,
    session: Session,
    estimated_review_seconds: int,
    review_stage_total: int,
    review_stage_completed: int,
    review_stage_progress: float,
    stage_labels: list[str],
) -> dict[str, Any] | None:
    remaining_uids = remaining_unclaimed_node_uids(palace)
    if not remaining_uids:
        return None

    timing = build_virtual_default_segment_timing(
        palace,
        session=session,
        review_stage_total=review_stage_total,
        review_stage_completed=review_stage_completed,
    )

    return {
        "id": 0,
        "palace_id": palace.id,
        "name": "第 1 部分",
        "display_name": "第 1 部分",
        "color": "#94a3b8",
        "created_at": palace.created_at.isoformat() if palace.created_at else None,
        "sort_order": -1,
        "node_uids": remaining_uids,
        "node_count": len(remaining_uids),
        "estimated_review_seconds": estimated_review_seconds,
        "review_stage_total": review_stage_total,
        "review_stage_completed": review_stage_completed,
        "review_stage_progress": review_stage_progress,
        "stage_labels": stage_labels,
        "review_stages": palace_review_stages_json(session, palace, stage_labels),
        "next_review_at": timing["next_review_at"],
        "has_due_review": timing["has_due_review"],
        "current_review_schedule_id": timing["current_review_schedule_id"],
        "is_empty": len(remaining_uids) == 0,
        "is_virtual_default": True,
    }


def build_palace_default_segment_summary(
    session: Session,
    palace: Palace,
) -> dict[str, Any] | None:
    total, completed, progress = palace_stage_progress(session, palace)
    algorithm = _palace_algorithm(session, palace)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
    return build_virtual_default_segment_summary(
        palace,
        session=session,
        estimated_review_seconds=estimate_palace_review_seconds(palace),
        review_stage_total=total,
        review_stage_completed=completed,
        review_stage_progress=progress,
        stage_labels=stage_labels,
    )


def list_palace_segments(
    session: Session,
    palace: Palace,
    *,
    default_segment_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    cleanup_segment_node_uids(session, palace)
    items: list[dict[str, Any]] = []
    if default_segment_payload and default_segment_payload.get("node_uids"):
        items.append(default_segment_payload)
    items.extend(segment_summary_json(session, segment) for segment in palace.segments)
    return items


def palace_has_virtual_default_segment(palace: Palace) -> bool:
    return bool(remaining_unclaimed_node_uids(palace))


def get_segment_display_name(palace: Palace, segment: PalaceSegment) -> str:
    raw_name = str(segment.name or "").strip()
    if raw_name != "第 1 部分":
        return raw_name or f"第 {segment.sort_order + 1} 部分"
    index_offset = 1 if palace_has_virtual_default_segment(palace) else 0
    return f"第 {segment.sort_order + 1 + index_offset} 部分"


def create_palace_segment(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
) -> PalaceSegment:
    normalized_uids = normalize_segment_node_uids(
        session,
        palace,
        [str(item or "").strip() for item in payload.get("node_uids", []) if str(item or "").strip()],
    )
    segment = PalaceSegment(
        palace_id=palace.id,
        name=str(payload.get("name") or "").strip() or _next_segment_name(palace),
        color=str(payload.get("color") or "").strip() or SEGMENT_COLOR_PALETTE[len(palace.segments) % len(SEGMENT_COLOR_PALETTE)],
        node_uids_json=serialize_segment_node_uids(normalized_uids),
        created_at=_parse_segment_datetime(payload.get("created_at")) or _default_segment_created_at(palace),
        sort_order=max([item.sort_order for item in palace.segments], default=-1) + 1,
    )
    session.add(segment)
    session.flush()
    ensure_segment_schedule_model(session, segment)
    session.commit()
    session.refresh(segment)
    return segment


def update_palace_segment(
    session: Session,
    segment: PalaceSegment,
    payload: dict[str, Any],
) -> PalaceSegment:
    if "name" in payload:
        segment.name = str(payload.get("name") or "").strip() or segment.name
    if "color" in payload:
        segment.color = str(payload.get("color") or "").strip() or segment.color
    if "created_at" in payload:
        parsed_created_at = _parse_segment_datetime(payload.get("created_at"))
        if parsed_created_at is not None:
            segment.created_at = parsed_created_at
    if "sort_order" in payload:
        segment.sort_order = max(0, int(payload.get("sort_order") or 0))
    if "node_uids" in payload:
        segment.node_uids_json = serialize_segment_node_uids(
            normalize_segment_node_uids(
                session,
                segment.palace,
                [str(item or "").strip() for item in payload.get("node_uids", []) if str(item or "").strip()],
                exclude_segment_id=segment.id,
            )
        )
    ensure_segment_schedule_model(session, segment)
    session.commit()
    session.refresh(segment)
    return segment


def delete_palace_segment(session: Session, segment: PalaceSegment) -> None:
    session.delete(segment)
    session.commit()


def _parse_segment_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def get_palace_segment(session: Session, segment_id: int) -> PalaceSegment | None:
    return session.query(PalaceSegment).filter_by(id=segment_id).first()


def build_segment_editor_doc(palace: Palace, segment: PalaceSegment) -> dict[str, Any]:
    return build_segments_editor_doc(
        palace,
        [parse_segment_node_uids(segment.node_uids_json)],
    )


def create_segment_review_log(
    session: Session,
    *,
    segment: PalaceSegment,
    duration_seconds: int,
    completed_at: datetime | None = None,
) -> PalaceSegmentReviewLog:
    effective_completed_at = completed_at or datetime.now()
    log = PalaceSegmentReviewLog(
        palace_segment_id=segment.id,
        review_date=effective_completed_at.date(),
        score=5,
        review_mode="review",
        duration_seconds=max(0, int(duration_seconds)),
    )
    session.add(log)
    session.flush()
    return log
