"""Review submission and repair commands."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    ReviewLog,
    ReviewSchedule,
    SessionProgress,
    StudySession,
)
from memory_anki.modules.palaces.application.segment_nodes import collect_doc_nodes_with_descendants
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_all_pending_review_schedules,
    rebuild_palace_review_schedules,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    get_algorithm_intervals,
    get_initial_same_day_slot_count,
    is_schedule_due_or_later_today,
    normalize_algorithm,
)
from memory_anki.modules.sessions.application.study_session_service import (
    ACTIVE_STATUSES,
    create_review_study_session,
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
    if schedule_review_type == "standard":
        return completed_count
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    if schedule_review_number < initial_slot_count:
        return max(completed_count, min(initial_slot_count, total_intervals))
    return completed_count


def _should_preserve_same_day_slots(schedule_review_type: str | None) -> bool:
    return schedule_review_type in {"1h", "sleep"}


def submit_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
    *,
    commit: bool = True,
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
        preserve_existing_progress=False,
        preserve_same_day_slots=_should_preserve_same_day_slots(schedule.review_type),
    )
    palace.needs_practice = bool(needs_practice)
    if next_review_number >= len(intervals):
        extra["mastered"] = True

    session.flush()
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
        },
        commit=commit,
    )
    if commit:
        session.commit()
        session.refresh(log)
    else:
        session.flush()
    return log, extra


def repair_review_stage_progress(session: Session) -> dict:
    result = rebuild_all_pending_review_schedules(session)
    orphan_progress_count = _migrate_orphan_review_progress(session)
    orphan_study_session_count = _migrate_orphan_review_study_sessions(session)
    practice_recovery_count = _recover_review_progress_from_practice(session)
    study_session_count = _sync_review_progress_to_study_sessions(session)
    session.commit()
    return {
        **result,
        "orphan_progress_count": orphan_progress_count,
        "orphan_study_session_count": orphan_study_session_count,
        "practice_recovery_count": practice_recovery_count,
        "study_session_count": study_session_count,
    }


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    create_initial_review_schedules(session, palace_id, "ebbinghaus")


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
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    return {str(uid) for uid in descendants if str(uid).strip()}


def _root_uid(palace: Palace | None) -> str | None:
    if palace is None:
        return None
    doc = _json_loads(palace.editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    data = root.get("data") if isinstance(root, dict) and isinstance(root.get("data"), dict) else {}
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
    reveal_map = payload.get("reveal_map") if isinstance(payload.get("reveal_map"), dict) else {}
    red_node_ids = payload.get("red_node_ids") if isinstance(payload.get("red_node_ids"), list) else []
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
    return (
        session.query(ReviewSchedule)
        .filter_by(palace_id=palace_id, completed=False)
        .order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc())
        .first()
    )


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
            if (current.updated_at or datetime.min) >= (progress.updated_at or datetime.min):
                continue
            session.delete(current)
            session.flush()
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
            if (current.updated_at or datetime.min) >= (row.updated_at or datetime.min):
                row.status = "abandoned"
                row.ended_at = datetime.now().replace(second=0, microsecond=0)
                changed += 1
                continue
            current.status = "abandoned"
            current.ended_at = datetime.now().replace(second=0, microsecond=0)
        row.target_id = target.id
        row.palace_id = target.palace_id
        row.palace_segment_id = None
        row.mini_palace_id = None
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
