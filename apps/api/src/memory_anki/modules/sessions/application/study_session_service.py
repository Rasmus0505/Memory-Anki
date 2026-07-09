from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession

from .serialization import (
    _int_or_none,
    _json_dumps,
    _json_loads,
    _normalize_payload_datetime,
    _normalize_scene,
    _normalize_status,
    _normalize_target_type,
    _parse_datetime,
    study_session_json,
)
from .study_session_constants import (
    ACTIVE_STATUSES,
)
from .study_session_constants import (
    ENGLISH_READING_SCENES as ENGLISH_READING_SCENES,
)
from .study_session_constants import (
    ENGLISH_SCENES as ENGLISH_SCENES,
)
from .study_session_constants import (
    FORMAL_REVIEW_SCENES as FORMAL_REVIEW_SCENES,
)
from .study_session_constants import (
    STUDY_DASHBOARD_SCENES as STUDY_DASHBOARD_SCENES,
)
from .study_session_stats import (
    build_study_session_stats as build_study_session_stats,
)
from .study_session_stats import (
    get_all_time_study_session_duration_seconds as get_all_time_study_session_duration_seconds,
)
from .study_session_stats import (
    get_english_study_stats as get_english_study_stats,
)
from .study_session_stats import (
    get_study_session_duration_seconds as get_study_session_duration_seconds,
)
from .study_session_stats import (
    get_today_palace_learning_breakdown as get_today_palace_learning_breakdown,
)
from .time_bounds import (
    current_month_bounds as current_month_bounds,
)
from .time_bounds import (
    current_week_bounds as current_week_bounds,
)
from .time_bounds import (
    date_range_bounds as date_range_bounds,
)
from .time_bounds import (
    month_bounds as month_bounds,
)
from .time_bounds import (
    today_bounds as today_bounds,
)


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
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = session.query(StudySession).order_by(StudySession.started_at.desc())
    query = query.filter(StudySession.deleted_at.is_(None))
    if limit is not None:
        query = query.offset(max(0, offset)).limit(limit)
    rows = query.all()
    return [study_session_json(row) for row in rows]


def count_study_sessions(session: Session) -> int:
    return session.query(StudySession).filter(StudySession.deleted_at.is_(None)).count()
