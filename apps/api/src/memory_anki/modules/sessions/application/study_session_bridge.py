from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import ReviewLog

from .serialization import _int_or_none, _parse_datetime

# Timed-session leave/autosave used to write scene=review rows while formal
# review kept persistCompletionRecord=false. Those ghosts show up as "正式复习"
# time records but never carry completion_receipt mastery points.
GHOST_FORMAL_REVIEW_COMPLETION_METHODS = frozenset({"saved", "left_page"})


def _normalize_client_source(value: Any) -> str | None:
    normalized = str(value or "").strip()
    if normalized == "desktop":
        return "desktop"
    if normalized in {"pwa", "mobile"}:
        return "pwa"
    return None


def _is_ghost_formal_review_time_payload(payload: dict[str, Any]) -> bool:
    kind = str(payload.get("kind") or "practice")
    if kind != "review":
        return False
    method = str(
        payload.get("completionMethod") or payload.get("completion_method") or ""
    )
    return method in GHOST_FORMAL_REVIEW_COMPLETION_METHODS


def create_completed_study_session_from_time_payload(
    session: Session,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
    from .study_session_service import create_study_session

    effective_seconds = max(0, int(payload.get("effectiveSeconds", payload.get("effective_seconds", 0)) or 0))
    started_at = _parse_datetime(payload.get("startedAt") or payload.get("started_at"))
    ended_at = _parse_datetime(payload.get("endedAt") or payload.get("ended_at"))
    if started_at is None or ended_at is None:
        raise ValueError("开始时间和结束时间不能为空。")
    source_kind = payload.get("sourceKind") or payload.get("source_kind")
    kind = str(payload.get("kind") or "practice")
    reclassified_from_review_timer = False
    if _is_ghost_formal_review_time_payload(payload):
        # Keep the duration in practice stats; never mint a formal-review row
        # without a /review/session submit receipt.
        kind = "practice"
        reclassified_from_review_timer = True
    scene = _scene_from_legacy_kind(kind, source_kind)
    target_type = "none"
    target_id = None
    palace_id = _int_or_none(payload.get("palaceId") or payload.get("palace_id"))
    palace_segment_id = _int_or_none(payload.get("palaceSegmentId") or payload.get("palace_segment_id"))
    english_course_id = _int_or_none(payload.get("englishCourseId") or payload.get("english_course_id"))
    if english_course_id is not None:
        target_type, target_id = "english_course", english_course_id
    elif palace_segment_id is not None:
        target_type, target_id = "palace_segment", palace_segment_id
    elif palace_id is not None:
        target_type, target_id = "palace", palace_id
    raw_summary = payload.get("summary")
    summary_payload = raw_summary if isinstance(raw_summary, dict) else {}
    summary_payload = {
        **summary_payload,
        "scene_segments": payload.get("sceneSegments") or payload.get("scene_segments") or [],
        "duration_edited": bool(payload.get("durationEdited", payload.get("duration_edited", False))),
    }
    if reclassified_from_review_timer:
        summary_payload["reclassified_from"] = "review_timer_ghost"
        summary_payload["original_kind"] = "review"
    client_source = _normalize_client_source(payload.get("clientSource") or payload.get("client_source"))
    if client_source is not None:
        summary_payload["client_source"] = client_source
    item = create_study_session(
        session,
        {
            "id": str(payload.get("id") or uuid4()),
            "status": "completed",
            "scene": scene,
            "target_type": target_type,
            "target_id": target_id,
            "palace_id": palace_id,
            "palace_segment_id": palace_segment_id,
            "english_course_id": english_course_id,
            "title": payload.get("title") or "",
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
            "effective_seconds": effective_seconds,
            "pause_count": max(0, int(payload.get("pauseCount", payload.get("pause_count", 0)) or 0)),
            "completion_method": payload.get("completionMethod") or payload.get("completion_method") or "manual_complete",
            "events": payload.get("events") or [],
            "summary": summary_payload,
        },
        commit=commit,
    )
    return item


def _scene_from_legacy_kind(kind: str, source_kind: Any) -> str:
    if source_kind == "english":
        return "english"
    if source_kind == "english_reading":
        return "english_reading"
    if kind == "palace_edit":
        return "palace_edit"
    if kind == "quiz":
        return "quiz"
    if kind == "review":
        return "review"
    if kind == "practice":
        return "practice"
    return kind


def create_review_study_session(
    session: Session,
    *,
    session_id: str,
    scene: str,
    target_type: str,
    target_id: int | None,
    title: str,
    palace_id: int | None,
    palace_segment_id: int | None = None,
    mini_palace_id: int | None = None,
    ended_at: datetime | None = None,
    duration_seconds: int,
    completion_method: str = "auto_complete",
    summary: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any] | None:
    from .study_session_service import create_study_session

    effective_seconds = max(0, int(duration_seconds))
    resolved_ended_at = ended_at or utc_now_naive()
    started_at = resolved_ended_at - timedelta(seconds=effective_seconds)
    return create_study_session(
        session,
        {
            "id": session_id,
            "status": "completed",
            "scene": scene,
            "target_type": target_type,
            "target_id": target_id,
            "palace_id": palace_id,
            "palace_segment_id": palace_segment_id,
            "mini_palace_id": mini_palace_id,
            "title": title,
            "started_at": started_at.isoformat(),
            "ended_at": resolved_ended_at.isoformat(),
            "effective_seconds": effective_seconds,
            "completion_method": completion_method,
            "events": [
                {"type": "review_submit", "at": resolved_ended_at.isoformat(), "meta": summary or {}}
            ],
            "summary": summary or {},
        },
        commit=commit,
    )


def ensure_review_log_study_sessions(session: Session) -> int:
    review_logs = (
        session.query(ReviewLog)
        .filter(ReviewLog.duration_seconds > 0)
        .order_by(ReviewLog.id.asc())
        .all()
    )
    created_count = 0
    for log in review_logs:
        session_id = f"review-log-{log.id}"
        existing = session.query(StudySession.id).filter_by(id=session_id).first()
        if existing is not None:
            continue
        duration_seconds = max(0, int(log.duration_seconds or 0))
        started_at = datetime.combine(log.review_date or date.today(), time.min)
        created = create_review_study_session(
            session,
            session_id=session_id,
            scene="review",
            target_type="palace" if log.palace_id is not None else "none",
            target_id=log.palace_id,
            palace_id=log.palace_id,
            title=log.palace.title if log.palace and log.palace.title else "复习",
            ended_at=started_at + timedelta(seconds=duration_seconds),
            duration_seconds=duration_seconds,
            completion_method="migrated_review_log",
            summary={
                "migrated_from": "review_logs",
                "review_log_id": log.id,
                "review_mode": log.review_mode,
                "score": log.score,
            },
        )
        if created is not None:
            created_count += 1
    return created_count


def reclassify_ghost_formal_review_time_sessions(session: Session) -> int:
    """Rewrite leave/autosave ghost formal-review rows to practice.

    Real formal completions use completion_method manual_complete/auto_complete
    and store completion_receipt. Ghost timer rows used saved/left_page only.
    """
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.completion_method.in_(tuple(GHOST_FORMAL_REVIEW_COMPLETION_METHODS)),
        )
        .all()
    )
    fixed = 0
    for row in rows:
        try:
            summary = json.loads(row.summary_json or "{}")
        except (TypeError, json.JSONDecodeError):
            summary = {}
        if not isinstance(summary, dict):
            summary = {}
        if isinstance(summary.get("completion_receipt"), dict):
            continue
        row.scene = "practice"
        if row.target_type in {"", "none"} and row.palace_id is not None:
            row.target_type = "palace"
            row.target_id = row.palace_id
        summary = {
            **summary,
            "reclassified_from": "review_timer_ghost",
            "original_kind": "review",
        }
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed
