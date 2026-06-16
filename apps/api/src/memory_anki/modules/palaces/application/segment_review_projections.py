from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewLog,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    cleanup_segment_node_uids,
    collect_doc_nodes_with_descendants,
    get_reviewable_doc_node_uids,
    parse_segment_node_uids,
    remaining_unclaimed_node_uids,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
    schedule_display_datetime,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    calculate_reveal_progress,
    get_review_progress,
    get_segment_review_progress,
)

from .segment_review_support import (
    palace_review_algorithm,
    palace_stage_completed_count,
    palace_stage_progress,
    review_stages_json,
    segment_review_algorithm,
    segment_stage_progress,
)
from .segment_review_timing import (
    build_virtual_default_segment_timing,
    ensure_segment_schedule_model,
    get_segment_schedule_display_datetime,
    is_segment_schedule_due,
)


def segment_review_stages_json(
    session: Session,
    segment: PalaceSegment,
    stage_labels: list[str],
) -> list[dict[str, Any]]:
    schedules = {
        schedule.review_number: schedule
        for schedule in sorted(segment.review_schedules or [], key=lambda item: item.id)
    }
    _, completed_count, _ = segment_stage_progress(session, segment)
    return review_stages_json(
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
    completed_count = palace_stage_completed_count(session, palace, len(stage_labels))
    return review_stages_json(
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
    total, completed, progress = segment_stage_progress(session, segment)
    algorithm = segment_review_algorithm(session, segment)
    display_name = get_segment_display_name(segment.palace, segment)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
    node_uids = parse_segment_node_uids(segment.node_uids_json)
    active_review_progress = None
    if next_schedule is not None:
        review_progress = get_segment_review_progress(session, next_schedule.id)
        if review_progress:
            review_doc = build_segment_editor_doc(segment.palace, segment)
            active_review_progress = calculate_reveal_progress(
                review_progress,
                get_reviewable_doc_node_uids(review_doc),
            )
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
        "current_review_type": next_schedule.review_type if next_schedule else None,
        "active_review_progress": active_review_progress,
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
    remaining_uids: list[str] | None = None,
    active_review_progress: float | None = None,
) -> dict[str, Any] | None:
    remaining_uids = remaining_uids if remaining_uids is not None else remaining_unclaimed_node_uids(palace)
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
        "current_review_type": timing["current_review_type"],
        "active_review_progress": active_review_progress,
        "is_empty": len(remaining_uids) == 0,
        "is_virtual_default": True,
    }


def build_palace_default_segment_summary(
    session: Session,
    palace: Palace,
) -> dict[str, Any] | None:
    total, completed, progress = palace_stage_progress(session, palace)
    algorithm = palace_review_algorithm(session, palace)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
    remaining_uids = remaining_unclaimed_node_uids(palace)
    if not remaining_uids:
        return None
    pending_schedules = sorted(
        [schedule for schedule in (palace.review_schedules or []) if not schedule.completed],
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    next_schedule = pending_schedules[0] if pending_schedules else None
    active_review_progress = None
    if next_schedule is not None:
        review_progress = get_review_progress(session, next_schedule.id)
        if review_progress:
            review_doc = build_segments_editor_doc(palace, [remaining_uids])
            active_review_progress = calculate_reveal_progress(
                review_progress,
                get_reviewable_doc_node_uids(review_doc),
            )
    return build_virtual_default_segment_summary(
        palace,
        session=session,
        estimated_review_seconds=estimate_palace_review_seconds(palace),
        review_stage_total=total,
        review_stage_completed=completed,
        review_stage_progress=progress,
        stage_labels=stage_labels,
        remaining_uids=remaining_uids,
        active_review_progress=active_review_progress,
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


__all__ = [
    "build_palace_default_segment_summary",
    "build_segment_editor_doc",
    "build_virtual_default_segment_summary",
    "create_segment_review_log",
    "estimate_palace_review_seconds",
    "estimate_segment_review_seconds",
    "get_segment_display_name",
    "list_palace_segments",
    "palace_has_virtual_default_segment",
    "palace_review_stages_json",
    "palace_stage_progress",
    "segment_review_stages_json",
    "segment_summary_json",
]
