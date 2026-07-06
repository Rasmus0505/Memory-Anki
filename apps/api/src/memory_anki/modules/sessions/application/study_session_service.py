from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Palace, ReviewLog, StudySession

ACTIVE_STATUSES = ("active", "paused", "recovered")
STUDY_DASHBOARD_SCENES = (
    "palace_edit",
    "practice",
    "focus_practice",
    "segment_practice",
    "mini_practice",
    "review",
    "segment_review",
    "mini_review",
    "quiz",
    "freestyle",
)
FORMAL_REVIEW_SCENES = ("review", "segment_review", "mini_review")
ENGLISH_SCENES = ("english",)
ENGLISH_READING_SCENES = ("english_reading",)


def _json_dumps(value: Any, fallback: str) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def _json_loads(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _parse_datetime(raw: Any) -> datetime | None:
    if raw in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=None)
    return parsed.astimezone().replace(tzinfo=None)


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _normalize_status(value: Any, default: str = "active") -> str:
    normalized = str(value or default).strip()
    if normalized not in {"active", "paused", "completed", "abandoned", "recovered"}:
        return default
    return normalized


def _normalize_scene(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("scene 不能为空。")
    return normalized


def _normalize_target_type(value: Any) -> str:
    normalized = str(value or "none").strip() or "none"
    return normalized


def _int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _normalize_payload_datetime(payload: dict[str, Any], key: str, default: datetime | None = None) -> datetime | None:
    return _parse_datetime(payload.get(key)) or default


def study_session_json(row: StudySession) -> dict[str, Any]:
    return {
        "id": row.id,
        "status": row.status,
        "scene": row.scene,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "palace_id": row.palace_id,
        "palace_segment_id": row.palace_segment_id,
        "mini_palace_id": row.mini_palace_id,
        "english_course_id": row.english_course_id,
        "english_reading_material_id": row.english_reading_material_id,
        "title": row.title,
        "started_at": _serialize_datetime(row.started_at),
        "ended_at": _serialize_datetime(row.ended_at),
        "effective_seconds": int(row.effective_seconds or 0),
        "idle_seconds": int(row.idle_seconds or 0),
        "pause_count": int(row.pause_count or 0),
        "completion_method": row.completion_method,
        "progress": _json_loads(row.progress_json, {}),
        "events": _json_loads(row.events_json, []),
        "summary": _json_loads(row.summary_json, {}),
        "deleted_at": _serialize_datetime(row.deleted_at),
        "deleted_reason": row.deleted_reason,
        "created_at": _serialize_datetime(row.created_at),
        "updated_at": _serialize_datetime(row.updated_at),
    }


def create_study_session(
    session: Session,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any]:
    now = utc_now_naive()
    session_id = str(payload.get("id") or uuid4())
    started_at = _normalize_payload_datetime(payload, "started_at", now) or now
    row = StudySession(
        id=session_id,
        status=_normalize_status(payload.get("status")),
        scene=_normalize_scene(payload.get("scene")),
        target_type=_normalize_target_type(payload.get("target_type")),
        target_id=_int_or_none(payload.get("target_id")),
        palace_id=_int_or_none(payload.get("palace_id")),
        palace_segment_id=_int_or_none(payload.get("palace_segment_id")),
        mini_palace_id=_int_or_none(payload.get("mini_palace_id")),
        english_course_id=_int_or_none(payload.get("english_course_id")),
        english_reading_material_id=_int_or_none(payload.get("english_reading_material_id")),
        title=str(payload.get("title") or ""),
        started_at=started_at,
        ended_at=_normalize_payload_datetime(payload, "ended_at"),
        effective_seconds=max(0, int(payload.get("effective_seconds") or 0)),
        idle_seconds=max(0, int(payload.get("idle_seconds") or 0)),
        pause_count=max(0, int(payload.get("pause_count") or 0)),
        completion_method=str(payload.get("completion_method") or ""),
        progress_json=_json_dumps(payload.get("progress") or {}, "{}"),
        events_json=_json_dumps(payload.get("events") or [{"type": "start", "at": started_at.isoformat()}], "[]"),
        summary_json=_json_dumps(payload.get("summary") or {}, "{}"),
        created_at=now,
        updated_at=now,
    )
    persistent = session.merge(row)
    if commit:
        session.commit()
        session.refresh(persistent)
    else:
        session.flush()
    return study_session_json(persistent)


def get_study_session(session: Session, session_id: str) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    return study_session_json(row) if row else None


def patch_study_session(session: Session, session_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    mapping = {
        "status": ("status", lambda value: _normalize_status(value, row.status)),
        "scene": ("scene", _normalize_scene),
        "target_type": ("target_type", _normalize_target_type),
        "target_id": ("target_id", _int_or_none),
        "palace_id": ("palace_id", _int_or_none),
        "palace_segment_id": ("palace_segment_id", _int_or_none),
        "mini_palace_id": ("mini_palace_id", _int_or_none),
        "english_course_id": ("english_course_id", _int_or_none),
        "english_reading_material_id": ("english_reading_material_id", _int_or_none),
        "title": ("title", str),
        "effective_seconds": ("effective_seconds", lambda value: max(0, int(value or 0))),
        "idle_seconds": ("idle_seconds", lambda value: max(0, int(value or 0))),
        "pause_count": ("pause_count", lambda value: max(0, int(value or 0))),
        "completion_method": ("completion_method", str),
    }
    for key, (field, transform) in mapping.items():
        if key in payload:
            setattr(row, field, transform(payload[key]))
    if "started_at" in payload:
        parsed = _parse_datetime(payload.get("started_at"))
        if parsed is not None:
            row.started_at = parsed
    if "ended_at" in payload:
        row.ended_at = _parse_datetime(payload.get("ended_at"))
    if "progress" in payload:
        row.progress_json = _json_dumps(payload.get("progress") or {}, "{}")
    if "summary" in payload:
        row.summary_json = _json_dumps(payload.get("summary") or {}, "{}")
    if "events" in payload:
        row.events_json = _json_dumps(payload.get("events") or [], "[]")
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
    return study_session_json(row)


def append_study_session_events(
    session: Session,
    session_id: str,
    events: list[dict[str, Any]],
) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    current_events = _json_loads(row.events_json, [])
    if not isinstance(current_events, list):
        current_events = []
    current_events.extend(event for event in events if isinstance(event, dict))
    row.events_json = _json_dumps(current_events, "[]")
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
    return study_session_json(row)


def complete_study_session(session: Session, session_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    ended_at = _parse_datetime(payload.get("ended_at")) or utc_now_naive()
    row.status = "completed"
    row.ended_at = ended_at
    row.effective_seconds = max(0, int(payload.get("effective_seconds", row.effective_seconds or 0)))
    row.idle_seconds = max(0, int(payload.get("idle_seconds", row.idle_seconds or 0)))
    row.pause_count = max(0, int(payload.get("pause_count", row.pause_count or 0)))
    row.completion_method = str(payload.get("completion_method") or row.completion_method or "manual_complete")
    if "progress" in payload:
        row.progress_json = _json_dumps(payload.get("progress") or {}, "{}")
    if "summary" in payload:
        row.summary_json = _json_dumps(payload.get("summary") or {}, "{}")
    event = {
        "type": row.completion_method or "complete",
        "at": ended_at.isoformat(),
        "meta": {"effective_seconds": row.effective_seconds},
    }
    current_events = _json_loads(row.events_json, [])
    row.events_json = _json_dumps([*(current_events if isinstance(current_events, list) else []), event], "[]")
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
    return study_session_json(row)


def abandon_study_session(session: Session, session_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    ended_at = _parse_datetime(payload.get("ended_at")) or utc_now_naive()
    row.status = "abandoned"
    row.ended_at = ended_at
    row.completion_method = str(payload.get("completion_method") or "abandoned")
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
    return study_session_json(row)


def list_active_study_sessions(session: Session) -> list[dict[str, Any]]:
    rows = (
        session.query(StudySession)
        .filter(StudySession.status.in_(ACTIVE_STATUSES), StudySession.deleted_at.is_(None))
        .order_by(StudySession.updated_at.desc(), StudySession.started_at.desc())
        .all()
    )
    return [study_session_json(row) for row in rows]


def get_active_study_session_by_target(
    session: Session,
    *,
    target_type: str,
    target_id: int | None,
    scene: str | None = None,
) -> dict[str, Any] | None:
    query = session.query(StudySession).filter(
        StudySession.status.in_(ACTIVE_STATUSES),
        StudySession.deleted_at.is_(None),
        StudySession.target_type == target_type,
    )
    if target_id is None:
        query = query.filter(StudySession.target_id.is_(None))
    else:
        query = query.filter(StudySession.target_id == target_id)
    if scene:
        query = query.filter(StudySession.scene == scene)
    row = query.order_by(StudySession.updated_at.desc(), StudySession.started_at.desc()).first()
    return study_session_json(row) if row else None


def delete_study_session(session: Session, session_id: str) -> bool:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return False
    session.delete(row)
    session.commit()
    return True


def bulk_delete_study_sessions(session: Session, session_ids: list[str]) -> int:
    normalized_ids = [str(item) for item in session_ids if str(item or "").strip()]
    if not normalized_ids:
        return 0
    deleted = (
        session.query(StudySession)
        .filter(StudySession.id.in_(normalized_ids))
        .delete(synchronize_session=False)
    )
    session.commit()
    return int(deleted or 0)


def list_study_sessions(
    session: Session,
    *,
    include_deleted: bool = False,
    include_below_threshold: bool = False,
) -> list[dict[str, Any]]:
    query = session.query(StudySession).order_by(StudySession.started_at.desc())
    query = query.filter(StudySession.deleted_at.is_(None))
    rows = query.all()
    return [study_session_json(row) for row in rows]


def create_completed_study_session_from_time_payload(
    session: Session,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    effective_seconds = max(0, int(payload.get("effectiveSeconds", payload.get("effective_seconds", 0)) or 0))
    started_at = _parse_datetime(payload.get("startedAt") or payload.get("started_at"))
    ended_at = _parse_datetime(payload.get("endedAt") or payload.get("ended_at"))
    if started_at is None or ended_at is None:
        raise ValueError("开始时间和结束时间不能为空。")
    source_kind = payload.get("sourceKind") or payload.get("source_kind")
    kind = str(payload.get("kind") or "practice")
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
            "summary": {"scene_segments": payload.get("sceneSegments") or payload.get("scene_segments") or []},
        },
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


def get_study_session_duration_seconds(
    session: Session,
    *,
    scenes: tuple[str, ...],
    start: datetime,
    end: datetime,
) -> int:
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(scenes),
            StudySession.started_at >= start,
            StudySession.started_at < end,
        )
        .all()
    )
    return sum(max(0, int(row.effective_seconds or 0)) for row in rows)


def get_all_time_study_session_duration_seconds(
    session: Session,
    *,
    scenes: tuple[str, ...],
) -> int:
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(scenes),
        )
        .all()
    )
    return sum(max(0, int(row.effective_seconds or 0)) for row in rows)


def get_today_palace_learning_breakdown(session: Session) -> list[dict[str, Any]]:
    start, end = today_bounds()
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(STUDY_DASHBOARD_SCENES),
            StudySession.palace_id.is_not(None),
            StudySession.started_at >= start,
            StudySession.started_at < end,
        )
        .order_by(StudySession.started_at.asc(), StudySession.id.asc())
        .all()
    )
    palace_ids = {int(row.palace_id) for row in rows if row.palace_id is not None}
    palace_rows = session.query(Palace).filter(Palace.id.in_(palace_ids)).all() if palace_ids else []
    palace_titles = {int(row.id): row.title or "未命名宫殿" for row in palace_rows}
    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        if row.palace_id is None:
            continue
        palace_id = int(row.palace_id)
        payload = grouped.setdefault(
            palace_id,
            {
                "palace_id": palace_id,
                "palace_title": palace_titles.get(palace_id) or row.title or "未命名宫殿",
                "total_seconds": 0,
                "review_seconds": 0,
                "practice_seconds": 0,
                "quiz_seconds": 0,
                "palace_edit_seconds": 0,
            },
        )
        seconds = max(0, int(row.effective_seconds or 0))
        payload["total_seconds"] += seconds
        if row.scene in FORMAL_REVIEW_SCENES:
            payload["review_seconds"] += seconds
        elif row.scene == "quiz":
            payload["quiz_seconds"] += seconds
        elif row.scene == "palace_edit":
            payload["palace_edit_seconds"] += seconds
        else:
            payload["practice_seconds"] += seconds
    return sorted(grouped.values(), key=lambda item: (-int(item["total_seconds"]), str(item["palace_title"])))


def build_study_session_stats(session: Session) -> dict[str, int]:
    today_start, today_end = today_bounds()
    week_start, week_end = current_week_bounds()
    return {
        "today_total_seconds": get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=today_start, end=today_end
        ),
        "weekly_total_seconds": get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=week_start, end=week_end
        ),
        "today_review_seconds": get_study_session_duration_seconds(
            session, scenes=FORMAL_REVIEW_SCENES, start=today_start, end=today_end
        ),
        "weekly_review_seconds": get_study_session_duration_seconds(
            session, scenes=FORMAL_REVIEW_SCENES, start=week_start, end=week_end
        ),
    }


def get_english_study_stats(session: Session) -> dict[str, int]:
    from memory_anki.infrastructure.db.models import EnglishCourse, EnglishCourseProgress

    today_start, today_end = today_bounds()
    week_start, week_end = current_week_bounds()
    today_practice_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
        start=today_start,
        end=today_end,
    )
    weekly_practice_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
        start=week_start,
        end=week_end,
    )
    total_practice_seconds = get_all_time_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
    )
    today_reading_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
        start=today_start,
        end=today_end,
    )
    weekly_reading_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
        start=week_start,
        end=week_end,
    )
    total_reading_seconds = get_all_time_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
    )
    total_courses = session.query(EnglishCourse).count()
    completed_courses = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(True))
        .count()
    )
    return {
        "total_courses": total_courses,
        "unfinished_courses": max(0, total_courses - completed_courses),
        "completed_courses": completed_courses,
        "today_practice_seconds": today_practice_seconds,
        "weekly_practice_seconds": weekly_practice_seconds,
        "total_practice_seconds": total_practice_seconds,
        "today_reading_seconds": today_reading_seconds,
        "weekly_reading_seconds": weekly_reading_seconds,
        "total_reading_seconds": total_reading_seconds,
        "today_total_seconds": today_practice_seconds + today_reading_seconds,
        "weekly_total_seconds": weekly_practice_seconds + weekly_reading_seconds,
        "total_seconds": total_practice_seconds + total_reading_seconds,
    }


def today_bounds() -> tuple[datetime, datetime]:
    start = datetime.combine(date.today(), time.min)
    return start, start + timedelta(days=1)


def current_week_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today - timedelta(days=today.weekday()), time.min)
    return start, start + timedelta(days=7)


def current_month_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today.replace(day=1), time.min)
    return start, _start_of_next_month(today.replace(day=1))


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    return datetime.combine(start_of_month, time.min), _start_of_next_month(start_of_month)


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return datetime.combine(start_date, time.min), datetime.combine(end_date + timedelta(days=1), time.min)


def _start_of_next_month(start_of_month: date) -> datetime:
    if start_of_month.month == 12:
        next_month = date(start_of_month.year + 1, 1, 1)
    else:
        next_month = date(start_of_month.year, start_of_month.month + 1, 1)
    return datetime.combine(next_month, time.min)
