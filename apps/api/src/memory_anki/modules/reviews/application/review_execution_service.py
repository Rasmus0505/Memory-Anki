"""Review submission and repair commands."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewLog,
    ReviewSchedule,
    SessionProgress,
)
from memory_anki.modules.mindmap_document.api import collect_node_descendants
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_palace_review_schedules,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    get_algorithm_intervals,
    get_algorithm_stage_labels,
    get_initial_same_day_slot_count,
    is_schedule_due_or_later_today,
    schedule_display_datetime,
)
from memory_anki.modules.sessions.api import (
    ACTIVE_STATUSES,
    create_review_study_session,
)


class ReviewSubmitConflictError(RuntimeError):
    pass


def _review_completion_payload(
    session: Session,
    *,
    log: ReviewLog,
    palace: Palace,
    chapter_id: int | None,
    completed_stage_number: int,
    completed_stage_count: int,
    needs_practice: bool,
) -> dict[str, Any]:
    stage_labels = get_algorithm_stage_labels(session)
    total_stage_count = len(stage_labels)
    next_palace_schedule = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=palace.id, completed=False)
        .order_by(ReviewSchedule.review_number, ReviewSchedule.id)
        .first()
    )
    next_review_datetime = (
        schedule_display_datetime(next_palace_schedule, palace, session)
        if next_palace_schedule is not None
        else None
    )
    next_review_at = next_review_datetime.isoformat() if next_review_datetime is not None else None
    resolved_chapter_id = chapter_id
    if resolved_chapter_id is None and palace.chapters:
        resolved_chapter_id = min(chapter.id for chapter in palace.chapters)
    return {
        "review_log_id": log.id,
        "palace_id": palace.id,
        "chapter_id": resolved_chapter_id,
        "duration_seconds": max(0, int(log.duration_seconds or 0)),
        "completed_stage_count": min(completed_stage_count, total_stage_count),
        "total_stage_count": total_stage_count,
        "completed_stage_label": (
            stage_labels[completed_stage_number]
            if 0 <= completed_stage_number < total_stage_count
            else None
        ),
        "next_stage_label": (
            stage_labels[completed_stage_count]
            if 0 <= completed_stage_count < total_stage_count
            else None
        ),
        "next_review_at": next_review_at,
        "mastered": bool(palace.mastered),
        "needs_practice": bool(needs_practice),
    }


def get_review_completion(session: Session, review_log_id: int) -> dict[str, Any] | None:
    log = (
        session.query(ReviewLog)
        .join(Palace)
        .filter(ReviewLog.id == review_log_id, Palace.deleted_at.is_(None))
        .first()
    )
    if log is None or log.palace is None:
        return None
    study_session = session.get(StudySession, f"review-log-{review_log_id}")
    summary = _json_loads(study_session.summary_json if study_session else None, {})
    stored_receipt = summary.get("completion_receipt")
    if isinstance(stored_receipt, dict):
        return {
            **stored_receipt,
            "review_log_id": log.id,
            "palace_id": log.palace_id,
            "duration_seconds": max(0, int(log.duration_seconds or 0)),
        }
    stage_labels = get_algorithm_stage_labels(session)
    completed_stage_count = sum(
        1 for schedule in (log.palace.review_schedules or []) if schedule.completed
    )
    if log.palace.mastered:
        completed_stage_count = len(stage_labels)
    completed_stage_number = summary.get("target_review_number")
    if not isinstance(completed_stage_number, int):
        completed_stage_number = summary.get("review_number")
    if not isinstance(completed_stage_number, int):
        completed_stage_number = max(0, completed_stage_count - 1)
    chapter_id = summary.get("chapter_id")
    return _review_completion_payload(
        session,
        log=log,
        palace=log.palace,
        chapter_id=chapter_id if isinstance(chapter_id, int) else None,
        completed_stage_number=completed_stage_number,
        completed_stage_count=completed_stage_count,
        needs_practice=bool(summary.get("needs_practice", log.palace.needs_practice)),
    )


def _resolve_completed_count_after_submit(
    *,
    session: Session,
    schedule_review_type: str | None,
    schedule_review_number: int,
    requested_completed_count: int,
    total_intervals: int,
) -> int:
    completed_count = min(requested_completed_count, total_intervals)
    if schedule_review_type == "standard":
        return completed_count
    initial_slot_count = max(1, get_initial_same_day_slot_count(session))
    if schedule_review_number < initial_slot_count:
        return max(completed_count, min(initial_slot_count, total_intervals))
    return completed_count


def _should_preserve_same_day_slots(schedule_review_type: str | None) -> bool:
    return schedule_review_type in {"1h", "sleep"}


def detect_review_stage_progress_issues(session: Session) -> dict:
    """Read-only self-check for progress data handled by stage-progress repair."""
    schedule_ids = {row[0] for row in session.query(ReviewSchedule.id).all()}

    orphan_progress_ids = [
        progress.id
        for progress in session.query(SessionProgress)
        .filter(SessionProgress.session_kind == "review", SessionProgress.completed == False)
        .all()
        if progress.review_schedule_id is None
        or progress.review_schedule_id not in schedule_ids
    ]

    orphan_study_session_ids = [
        row.id
        for row in session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.target_type == "review_schedule",
            StudySession.status.in_(ACTIVE_STATUSES),
            StudySession.deleted_at.is_(None),
        )
        .all()
        if row.target_id is None or row.target_id not in schedule_ids
    ]
    orphan_progress_count = len(orphan_progress_ids)
    orphan_study_session_count = len(orphan_study_session_ids)

    schedules_by_palace: dict[int, list[ReviewSchedule]] = {}
    for schedule in session.query(ReviewSchedule).all():
        schedules_by_palace.setdefault(schedule.palace_id, []).append(schedule)

    stage_gap_palace_count = 0
    for schedules in schedules_by_palace.values():
        pending = [schedule.review_number for schedule in schedules if not schedule.completed]
        completed = [schedule.review_number for schedule in schedules if schedule.completed]
        if pending and completed and min(pending) < max(completed):
            stage_gap_palace_count += 1

    total_issues = orphan_progress_count + orphan_study_session_count + stage_gap_palace_count
    return {
        "orphan_progress_count": orphan_progress_count,
        "orphan_progress_ids": orphan_progress_ids,
        "orphan_study_session_count": orphan_study_session_count,
        "orphan_study_session_ids": orphan_study_session_ids,
        "stage_gap_palace_count": stage_gap_palace_count,
        "total_issues": total_issues,
        "needs_repair": total_issues > 0,
    }


def submit_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
    chapter_id: int | None = None,
    *,
    commit: bool = True,
) -> tuple[ReviewLog | None, dict[str, Any]]:
    schedule = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.id == schedule_id,
            Palace.deleted_at.is_(None),
        )
        .first()
    )
    if not schedule:
        return None, {}

    if schedule.completed:
        raise ReviewSubmitConflictError("该复习阶段已经完成，请刷新复习队列。")
    if not schedule.palace or not is_schedule_due_or_later_today(
        schedule,
        schedule.palace,
        session,
    ):
        raise ReviewSubmitConflictError("该复习阶段当前不可提交，请刷新复习队列。")

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
    extra: dict[str, Any] = {}
    intervals = get_algorithm_intervals(session)
    next_review_number = (
        target_review_number + 1
        if target_review_number is not None
        else schedule.review_number + 1
    )
    completed_count = _resolve_completed_count_after_submit(
        session=session,
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
        preserve_existing_progress=False,
        preserve_same_day_slots=_should_preserve_same_day_slots(schedule.review_type),
    )
    palace.needs_practice = bool(needs_practice)
    if next_review_number >= len(intervals):
        extra["mastered"] = True

    session.flush()
    completion_receipt = _review_completion_payload(
        session,
        log=log,
        palace=palace,
        chapter_id=chapter_id,
        completed_stage_number=(
            target_review_number
            if target_review_number is not None
            else schedule.review_number
        ),
        completed_stage_count=completed_count,
        needs_practice=needs_practice,
    )
    create_review_study_session(
        session,
        session_id=f"review-log-{log.id}",
        scene="review",
        target_type="review_schedule",
        target_id=schedule_id,
        palace_id=schedule.palace_id,
        palace_segment_id=None,
        title=palace.title if palace else "未命名宫殿",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
        summary={
            "review_number": schedule.review_number,
            "target_review_number": target_review_number,
            "needs_practice": bool(needs_practice),
            "chapter_id": chapter_id,
            "completion_receipt": completion_receipt,
        },
        commit=commit,
    )
    extra.update(completion_receipt)
    if commit:
        session.commit()
        session.refresh(log)
    else:
        session.flush()
    return log, extra


def trigger_review_for_palace(
    session: Session,
    palace_id: int,
    *,
    commit: bool = True,
) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    create_initial_review_schedules(session, palace_id, commit=commit)


def _json_loads(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _json_dumps(value: Any, fallback: str) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def _progress_payload(progress: SessionProgress) -> dict[str, Any]:
    return {
        "reveal_map": _json_loads(progress.reveal_map, {}),
        "red_node_ids": _json_loads(progress.red_node_ids, []),
        "completed": bool(progress.completed),
    }


def _valid_node_uids(palace: Palace | None) -> set[str]:
    if palace is None:
        return set()
    descendants, _ = collect_node_descendants(palace.editor_doc)
    return {str(uid) for uid in descendants if str(uid).strip()}


def _root_uid(palace: Palace | None) -> str | None:
    if palace is None:
        return None
    doc = _json_loads(palace.editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    raw_data = root.get("data") if isinstance(root, dict) else None
    data = raw_data if isinstance(raw_data, dict) else {}
    uid = str(data.get("uid") or "").strip()
    return uid or None


def _revealed_count(payload: dict[str, Any], palace: Palace | None, *, include_root: bool = False) -> int:
    reveal_map = payload.get("reveal_map")
    if not isinstance(reveal_map, dict):
        return 0
    valid_uids = _valid_node_uids(palace)
    root_uid = _root_uid(palace)
    return sum(
        1
        for uid in valid_uids
        if (include_root or uid != root_uid) and reveal_map.get(uid) == "revealed"
    )


def _clean_progress_payload(payload: dict[str, Any], palace: Palace | None) -> dict[str, Any]:
    valid_uids = _valid_node_uids(palace)
    raw_reveal_map = payload.get("reveal_map")
    reveal_map = raw_reveal_map if isinstance(raw_reveal_map, dict) else {}
    raw_red_node_ids = payload.get("red_node_ids")
    red_node_ids = raw_red_node_ids if isinstance(raw_red_node_ids, list) else []
    return {
        "reveal_map": {
            uid: str(reveal_map.get(uid) or "hidden")
            for uid in sorted(valid_uids)
            if str(reveal_map.get(uid) or "hidden") in {"hidden", "placeholder", "revealed"}
        },
        "red_node_ids": [str(uid) for uid in red_node_ids if str(uid) in valid_uids],
        "completed": bool(payload.get("completed", False)),
    }


def _pending_schedule_for_palace(session: Session, palace_id: int | None) -> ReviewSchedule | None:
    if palace_id is None:
        return None
    candidates = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=palace_id, completed=False)
        .order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc())
        .limit(2)
        .all()
    )
    return candidates[0] if len(candidates) == 1 else None


def _latest_completed_at(session: Session, palace_id: int | None) -> datetime | None:
    if palace_id is None:
        return None
    schedules = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=palace_id, completed=True)
        .all()
    )
    values = [schedule.completed_at for schedule in schedules if schedule.completed_at is not None]
    return max(values) if values else None


def _can_migrate_progress(session: Session, *, palace_id: int | None, updated_at: datetime | None) -> bool:
    latest_completed = _latest_completed_at(session, palace_id)
    if latest_completed is None or updated_at is None:
        return True
    return updated_at >= latest_completed


def _migrate_orphan_review_progress(session: Session) -> int:
    rows = (
        session.query(SessionProgress)
        .filter(SessionProgress.session_kind == "review", SessionProgress.completed == False)
        .order_by(SessionProgress.updated_at.desc(), SessionProgress.id.desc())
        .all()
    )
    changed = 0
    for progress in rows:
        if progress.review_schedule_id is not None:
            existing = session.query(ReviewSchedule.id).filter_by(id=progress.review_schedule_id).first()
            if existing is not None:
                continue
        if not _can_migrate_progress(
            session,
            palace_id=progress.palace_id,
            updated_at=progress.updated_at,
        ):
            continue
        target = _pending_schedule_for_palace(session, progress.palace_id)
        if target is None:
            continue
        current = (
            session.query(SessionProgress)
            .filter_by(session_kind="review", review_schedule_id=target.id)
            .first()
        )
        if current is not None and current.id != progress.id:
            continue
        progress.review_schedule_id = target.id
        progress.palace_id = target.palace_id
        progress.palace_segment_id = None
        progress.mini_palace_id = None
        changed += 1
    session.flush()
    return changed


def _migrate_orphan_review_study_sessions(session: Session) -> int:
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.target_type == "review_schedule",
            StudySession.status.in_(ACTIVE_STATUSES),
            StudySession.deleted_at.is_(None),
        )
        .order_by(StudySession.updated_at.desc(), StudySession.started_at.desc())
        .all()
    )
    changed = 0
    for row in rows:
        if row.target_id is not None:
            existing = session.query(ReviewSchedule.id).filter_by(id=row.target_id).first()
            if existing is not None:
                continue
        if not _can_migrate_progress(session, palace_id=row.palace_id, updated_at=row.updated_at):
            continue
        target = _pending_schedule_for_palace(session, row.palace_id)
        if target is None:
            continue
        current = (
            session.query(StudySession)
            .filter(
                StudySession.scene == "review",
                StudySession.target_type == "review_schedule",
                StudySession.target_id == target.id,
                StudySession.status.in_(ACTIVE_STATUSES),
                StudySession.deleted_at.is_(None),
            )
            .first()
        )
        if current is not None and current.id != row.id:
            continue
        original_target_id = row.target_id
        row.target_id = target.id
        row.palace_id = target.palace_id
        row.palace_segment_id = None
        row.mini_palace_id = None
        summary = _json_loads(row.summary_json, {})
        summary["review_stage_repair"] = {
            "version": 1,
            "original_target_id": original_target_id,
            "repaired_target_id": target.id,
        }
        row.summary_json = _json_dumps(summary, "{}")
        changed += 1
    session.flush()
    return changed


def _recover_review_progress_from_practice(session: Session) -> int:
    rows = (
        session.query(SessionProgress)
        .filter(SessionProgress.session_kind == "review", SessionProgress.completed == False)
        .all()
    )
    changed = 0
    for review_progress in rows:
        if review_progress.review_schedule_id is None:
            continue
        schedule = session.query(ReviewSchedule).filter_by(id=review_progress.review_schedule_id).first()
        if schedule is None or schedule.completed or schedule.palace is None:
            continue
        practice_progress = (
            session.query(SessionProgress)
            .filter_by(
                session_kind="practice",
                palace_id=schedule.palace_id,
                completed=False,
            )
            .first()
        )
        if practice_progress is None:
            continue
        current_payload = _progress_payload(review_progress)
        practice_payload = _progress_payload(practice_progress)
        if _revealed_count(practice_payload, schedule.palace) <= _revealed_count(current_payload, schedule.palace):
            continue
        cleaned = _clean_progress_payload(practice_payload, schedule.palace)
        review_progress.reveal_map = _json_dumps(cleaned["reveal_map"], "{}")
        review_progress.red_node_ids = _json_dumps(cleaned["red_node_ids"], "[]")
        review_progress.completed = False
        review_progress.updated_at = max(
            review_progress.updated_at or datetime.min,
            practice_progress.updated_at or datetime.min,
        )
        changed += 1
    session.flush()
    return changed


def _sync_review_progress_to_study_sessions(session: Session) -> int:
    rows = (
        session.query(SessionProgress)
        .filter(SessionProgress.session_kind == "review", SessionProgress.completed == False)
        .all()
    )
    changed = 0
    now = datetime.now().replace(second=0, microsecond=0)
    for progress in rows:
        if progress.review_schedule_id is None:
            continue
        schedule = session.query(ReviewSchedule).filter_by(id=progress.review_schedule_id).first()
        if schedule is None or schedule.completed:
            continue
        payload = _clean_progress_payload(_progress_payload(progress), schedule.palace)
        if _revealed_count(payload, schedule.palace, include_root=True) <= 0:
            continue
        existing = (
            session.query(StudySession)
            .filter(
                StudySession.scene == "review",
                StudySession.target_type == "review_schedule",
                StudySession.target_id == schedule.id,
                StudySession.status.in_(ACTIVE_STATUSES),
                StudySession.deleted_at.is_(None),
            )
            .order_by(StudySession.updated_at.desc(), StudySession.started_at.desc())
            .first()
        )
        if existing is not None:
            existing_payload = _json_loads(existing.progress_json, {})
            if (
                _revealed_count(existing_payload, schedule.palace) >= _revealed_count(payload, schedule.palace)
                and (existing.updated_at or datetime.min) >= (progress.updated_at or datetime.min)
            ):
                continue
            row = existing
        else:
            row = StudySession(
                id=str(uuid4()),
                status="active",
                scene="review",
                target_type="review_schedule",
                target_id=schedule.id,
                palace_id=schedule.palace_id,
                title=schedule.palace.title if schedule.palace else "复习",
                started_at=progress.updated_at or now,
                created_at=progress.updated_at or now,
            )
            session.add(row)
        row.status = "active"
        row.scene = "review"
        row.target_type = "review_schedule"
        row.target_id = schedule.id
        row.palace_id = schedule.palace_id
        row.palace_segment_id = None
        row.mini_palace_id = None
        row.title = schedule.palace.title if schedule.palace else row.title
        row.progress_json = _json_dumps(payload, "{}")
        row.updated_at = progress.updated_at or now
        changed += 1
    session.flush()
    return changed
