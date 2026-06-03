from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewLog,
    PalaceSegmentReviewSchedule,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    cleanup_segment_node_uids,
    collect_doc_nodes_with_descendants,
    parse_segment_node_uids,
    remaining_unclaimed_node_uids,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    build_review_schedule_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    resolve_interval_from_base_date,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count as infer_schedule_completed_stage_count,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    palace_algorithm as resolve_palace_review_algorithm,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    segment_algorithm as resolve_segment_review_algorithm,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_algorithm_stage_labels,
    get_config_value,
    is_schedule_due,
    normalize_algorithm,
    schedule_display_datetime,
)


def _default_segment_algorithm(session: Session) -> str:
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

    current_algorithm = _palace_algorithm(session, palace)
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
    policy = load_review_schedule_policy(session)
    algorithm = _segment_algorithm(
        session,
        segment,
        default_algorithm=policy.default_algorithm,
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    if not intervals:
        return
    anchor = _get_segment_anchor_date(segment)
    slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    for review_number in range(min(slot_count, len(intervals))):
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
        if draft is None:
            continue
        session.add(
            PalaceSegmentReviewSchedule(
                palace_segment_id=segment.id,
                scheduled_date=draft.scheduled_date,
                interval_days=draft.interval_days,
                algorithm_used=draft.algorithm_used,
                completed=draft.completed,
                completed_at=draft.completed_at,
                review_number=draft.review_number,
                review_type=draft.review_type,
                anchor_date=draft.anchor_date,
                scheduled_at=draft.scheduled_at,
            )
        )
    session.flush()


def _segment_progress(
    session: Session,
    segment: PalaceSegment,
) -> tuple[int, int, float]:
    algorithm = _segment_algorithm(session, segment)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed_count = infer_schedule_completed_stage_count(
        total=total,
        schedules=segment.review_schedules or [],
    )
    return total, completed_count, completed_count / total


def _serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def _segment_algorithm(
    session: Session,
    segment: PalaceSegment,
    *,
    default_algorithm: str | None = None,
) -> str:
    return resolve_segment_review_algorithm(
        session,
        segment,
        default_algorithm=default_algorithm or _default_segment_algorithm(session),
    )


def _palace_algorithm(
    session: Session,
    palace: Palace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return resolve_palace_review_algorithm(
        session,
        palace,
        default_algorithm=default_algorithm or _default_segment_algorithm(session),
    )


def _palace_stage_completed_count(
    session: Session,
    palace: Palace,
    total: int,
) -> int:
    return infer_schedule_completed_stage_count(
        total=total,
        schedules=palace.review_schedules or [],
        mastered=palace.mastered,
    )


def palace_stage_progress(
    session: Session,
    palace: Palace,
) -> tuple[int, int, float]:
    algorithm = _palace_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, algorithm)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed = _palace_stage_completed_count(session, palace, total)
    if not (palace.review_schedules or []):
        review_logs = [
            log
            for log in (palace.review_logs or [])
            if getattr(log, "review_mode", "") == "review"
        ]
        completed = max(completed, min(len(review_logs), total))
    if palace.mastered and total > 0:
        completed = total
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


def palace_has_virtual_default_segment(palace: Palace) -> bool:
    return bool(remaining_unclaimed_node_uids(palace))


def get_segment_display_name(palace: Palace, segment: PalaceSegment) -> str:
    raw_name = str(segment.name or "").strip()
    if raw_name != "第 1 部分":
        return raw_name or f"第 {segment.sort_order + 1} 部分"
    index_offset = 1 if palace_has_virtual_default_segment(palace) else 0
    return f"第 {segment.sort_order + 1 + index_offset} 部分"


def segment_summary_json(session: Session, segment: PalaceSegment) -> dict[str, Any]:
    ensure_segment_schedule_model(session, segment)
    cleanup_segment_node_uids(session, segment.palace)
    schedules = [item for item in segment.review_schedules if not item.completed]
    next_schedule = min(schedules, key=lambda item: (item.review_number, item.id)) if schedules else None
    next_review_at = get_segment_schedule_display_datetime(session, segment, next_schedule)
    total, completed, progress = _segment_progress(session, segment)
    algorithm = _segment_algorithm(session, segment)
    display_name = get_segment_display_name(segment.palace, segment)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
    node_uids = parse_segment_node_uids(segment.node_uids_json)
    return {
        "id": segment.id,
        "palace_id": segment.palace_id,
        "name": segment.name,
        "display_name": display_name,
        "color": segment.color,
        "created_at": segment.created_at.isoformat() if segment.created_at else None,
        "sort_order": segment.sort_order,
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "estimated_review_seconds": estimate_segment_review_seconds(segment),
        "review_stage_total": total,
        "review_stage_completed": completed,
        "review_stage_progress": progress,
        "stage_labels": stage_labels,
        "review_stages": segment_review_stages_json(session, segment, stage_labels),
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": is_segment_schedule_due(session, segment, next_schedule),
        "current_review_schedule_id": next_schedule.id if next_schedule else None,
        "is_empty": len(node_uids) == 0,
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
