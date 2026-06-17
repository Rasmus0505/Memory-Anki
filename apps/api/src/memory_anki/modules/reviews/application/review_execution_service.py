"""Review submission and repair commands."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    PalaceMiniPalaceReviewSchedule,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.palaces.application.mini_palace_service import (
    create_mini_palace_review_log,
    get_mini_palace_schedule_display_datetime,
    rebuild_mini_palace_review_progress,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    create_segment_review_log,
    ensure_segment_schedule_model,
    get_segment_schedule_display_datetime,
    is_segment_schedule_due,
    segment_summary_json,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_all_pending_review_schedules,
    rebuild_palace_review_schedules,
    rebuild_segment_review_schedules,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    get_algorithm_intervals,
    get_config_value,
    get_initial_same_day_slot_count,
    is_schedule_due_or_later_today,
    normalize_algorithm,
)
from memory_anki.modules.time_records.application.time_records_service import (
    create_review_time_record,
)


def _resolve_completed_count_after_submit(
    *,
    session: Session,
    algorithm: str,
    schedule_review_type: str | None,
    schedule_review_number: int,
    requested_completed_count: int,
    total_intervals: int,
) -> int:
    completed_count = min(requested_completed_count, total_intervals)
    if schedule_review_type != "standard":
        return completed_count
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    if schedule_review_number < initial_slot_count:
        return max(completed_count, min(initial_slot_count, total_intervals))
    return completed_count


def submit_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
) -> tuple[ReviewLog | None, dict]:
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}

    if not schedule.palace or not is_schedule_due_or_later_today(
        schedule,
        schedule.palace,
        session,
    ):
        return None, {}

    completed_at = datetime.now().replace(second=0, microsecond=0)
    today = completed_at.date()
    palace = schedule.palace
    log = ReviewLog(
        palace_id=schedule.palace_id,
        review_date=today,
        score=5,
        review_mode="review",
        duration_seconds=duration_seconds,
    )
    session.add(log)
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = (
        target_review_number + 1
        if target_review_number is not None
        else schedule.review_number + 1
    )
    completed_count = _resolve_completed_count_after_submit(
        session=session,
        algorithm=algorithm,
        schedule_review_type=schedule.review_type,
        schedule_review_number=schedule.review_number,
        requested_completed_count=next_review_number,
        total_intervals=len(intervals),
    )

    rebuild_palace_review_schedules(
        session,
        palace,
        completed_count=completed_count,
        completed_review_number=schedule.review_number,
        completed_at=completed_at,
    )
    palace.needs_practice = bool(needs_practice)
    if next_review_number >= len(intervals):
        extra["mastered"] = True

    session.flush()
    create_review_time_record(
        session,
        record_id=f"review-log-{log.id}",
        palace_id=schedule.palace_id,
        palace_segment_id=None,
        title=palace.title if palace else "未命名宫殿",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
    )
    session.commit()
    session.refresh(log)
    return log, extra


def submit_segment_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
) -> tuple[PalaceSegmentReviewSchedule | None, dict]:
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment:
        return None, {}
    segment = schedule.segment
    ensure_segment_schedule_model(session, segment)
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment or not schedule.segment.palace:
        return None, {}

    due_at = get_segment_schedule_display_datetime(session, schedule.segment, schedule)
    now = datetime.now()
    if due_at is None or (due_at > now and due_at.date() != now.date()):
        return None, {}

    completed_at = datetime.now().replace(second=0, microsecond=0)
    segment = schedule.segment
    completed_review_number = schedule.review_number
    create_segment_review_log(
        session,
        segment=segment,
        duration_seconds=duration_seconds,
        completed_at=completed_at,
    )
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = (
        target_review_number + 1
        if target_review_number is not None
        else schedule.review_number + 1
    )
    completed_count = _resolve_completed_count_after_submit(
        session=session,
        algorithm=algorithm,
        schedule_review_type=schedule.review_type,
        schedule_review_number=schedule.review_number,
        requested_completed_count=next_review_number,
        total_intervals=len(intervals),
    )

    rebuild_segment_review_schedules(
        session,
        segment,
        completed_count=completed_count,
        completed_review_number=completed_review_number,
        completed_at=completed_at,
    )
    segment.palace.needs_practice = bool(needs_practice)

    session.flush()
    create_review_time_record(
        session,
        record_id=f"segment-review-log-{schedule.id}-{int(completed_at.timestamp())}",
        palace_id=segment.palace_id,
        palace_segment_id=segment.id,
        title=f"{segment.palace.title} / {segment.name}",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
    )
    session.commit()
    completed_schedule = (
        session.query(PalaceSegmentReviewSchedule)
        .filter(
            PalaceSegmentReviewSchedule.palace_segment_id == segment.id,
            PalaceSegmentReviewSchedule.completed == True,
            PalaceSegmentReviewSchedule.review_number == completed_review_number,
        )
        .order_by(PalaceSegmentReviewSchedule.id.desc())
        .first()
    )
    return completed_schedule, extra


def submit_mini_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
) -> tuple[PalaceMiniPalaceReviewSchedule | None, dict]:
    schedule = (
        session.query(PalaceMiniPalaceReviewSchedule).filter_by(id=schedule_id).first()
    )
    if not schedule or not schedule.mini_palace or not schedule.mini_palace.palace:
        return None, {}

    mini_palace = schedule.mini_palace
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    now = datetime.now()
    if due_at is None or (due_at > now and due_at.date() != now.date()):
        return None, {}

    completed_at = datetime.now().replace(second=0, microsecond=0)
    completed_review_number = schedule.review_number
    create_mini_palace_review_log(
        session,
        mini_palace=mini_palace,
        duration_seconds=duration_seconds,
        completed_at=completed_at,
    )
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = (
        target_review_number + 1
        if target_review_number is not None
        else schedule.review_number + 1
    )
    completed_count = _resolve_completed_count_after_submit(
        session=session,
        algorithm=algorithm,
        schedule_review_type=schedule.review_type,
        schedule_review_number=schedule.review_number,
        requested_completed_count=next_review_number,
        total_intervals=len(intervals),
    )

    rebuild_mini_palace_review_progress(
        session,
        mini_palace,
        completed_count=completed_count,
        completed_review_number=completed_review_number,
        completed_at=completed_at,
    )
    mini_palace.needs_practice = bool(needs_practice)
    if next_review_number >= len(intervals):
        extra["mastered"] = True

    session.flush()
    create_review_time_record(
        session,
        record_id=f"mini-review-log-{schedule.id}-{int(completed_at.timestamp())}",
        palace_id=mini_palace.palace_id,
        palace_segment_id=None,
        title=f"{mini_palace.palace.title} / {mini_palace.name}",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
    )
    session.commit()
    completed_schedule = (
        session.query(PalaceMiniPalaceReviewSchedule)
        .filter(
            PalaceMiniPalaceReviewSchedule.palace_mini_palace_id == mini_palace.id,
            PalaceMiniPalaceReviewSchedule.completed == True,
            PalaceMiniPalaceReviewSchedule.review_number == completed_review_number,
        )
        .order_by(PalaceMiniPalaceReviewSchedule.id.desc())
        .first()
    )
    return completed_schedule, extra


def repair_review_stage_progress(session: Session) -> dict[str, Any]:
    return rebuild_all_pending_review_schedules(session)


def build_batch_segment_review_session(
    session: Session,
    segment_ids: list[int],
) -> dict[str, Any]:
    normalized_segment_ids = []
    for segment_id in segment_ids:
        try:
            value = int(segment_id)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in normalized_segment_ids:
            normalized_segment_ids.append(value)
    if not normalized_segment_ids:
        raise ValueError("请选择至少一个分块。")

    segments = (
        session.query(PalaceSegment)
        .filter(PalaceSegment.id.in_(normalized_segment_ids))
        .all()
    )
    segment_map = {segment.id: segment for segment in segments}
    ordered_segments = [segment_map.get(segment_id) for segment_id in normalized_segment_ids]
    if any(segment is None for segment in ordered_segments):
        raise ValueError("包含不存在的分块。")

    palace_ids = {segment.palace_id for segment in ordered_segments if segment is not None}
    if len(palace_ids) != 1:
        raise ValueError("只能同时复习同一宫殿下的分块。")

    summaries = []
    selected_node_uid_lists: list[list[str]] = []
    for segment in ordered_segments:
        ensure_segment_schedule_model(session, segment)
        summary = segment_summary_json(session, segment)
        if not summary["has_due_review"] or not summary["current_review_schedule_id"]:
            raise ValueError("只能选择当前到期且可开始复习的分块。")
        summaries.append(summary)
        selected_node_uid_lists.append(summary["node_uids"])

    palace = ordered_segments[0].palace if ordered_segments else None
    if palace is None:
        raise ValueError("当前分块未关联宫殿。")

    estimated_review_seconds = sum(
        max(0, int(summary.get("estimated_review_seconds") or 0))
        for summary in summaries
    )

    return {
        "palace": {
            "id": palace.id,
            "title": palace.title,
            "description": palace.description,
        },
        "segments": summaries,
        "editor_doc": build_segments_editor_doc(palace, selected_node_uid_lists),
        "estimated_review_seconds": estimated_review_seconds,
    }


def submit_batch_segment_review(
    session: Session,
    segment_ids: list[int],
    *,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
) -> dict[str, Any]:
    payload = build_batch_segment_review_session(session, segment_ids)
    summaries = payload["segments"]
    if not summaries:
        raise ValueError("请选择至少一个分块。")

    normalized_duration = max(0, int(duration_seconds))
    segment_count = len(summaries)
    per_segment_duration = normalized_duration // segment_count if segment_count > 0 else 0
    duration_remainder = normalized_duration % segment_count if segment_count > 0 else 0

    completed_segment_ids: list[int] = []
    for index, summary in enumerate(summaries):
        schedule_id = int(summary["current_review_schedule_id"])
        schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
        if not schedule or not schedule.segment or not schedule.segment.palace:
            raise ValueError("存在不可用的分块复习任务。")
        if not is_segment_schedule_due(session, schedule.segment, schedule):
            raise ValueError("所选分块中包含未到期任务。")
        segment_id = schedule.segment.id
        current_duration = per_segment_duration + (1 if index < duration_remainder else 0)
        submitted_schedule, _ = submit_segment_review(
            session,
            schedule_id,
            duration_seconds=current_duration,
            completion_mode=completion_mode,
        )
        if not submitted_schedule:
            raise ValueError("提交多块复习失败。")
        completed_segment_ids.append(segment_id)

    return {
        "ok": True,
        "completed_segment_ids": completed_segment_ids,
        "completion_mode": completion_mode,
    }


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    algorithm = get_config_value(session, "default_algorithm")
    create_initial_review_schedules(session, palace_id, algorithm)
