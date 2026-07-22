from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

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
    build_time_record_analytics as build_time_record_analytics,
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
    mapping: dict[str, tuple[str, Callable[[Any], Any]]] = {
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
        current_summary: dict[str, Any] = _json_loads(row.summary_json, {})
        raw_summary = payload.get("summary")
        next_summary = raw_summary if isinstance(raw_summary, dict) else {}
        if isinstance(current_summary, dict):
            row.summary_json = _json_dumps({**current_summary, **next_summary}, "{}")
        else:
            row.summary_json = _json_dumps(next_summary, "{}")
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
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    current_events: list[Any] = _json_loads(row.events_json, [])
    if not isinstance(current_events, list):
        current_events = []
    current_events.extend(event for event in events if isinstance(event, dict))
    row.events_json = _json_dumps(current_events, "[]")
    row.updated_at = utc_now_naive()
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return study_session_json(row)


def complete_study_session(
    session: Session,
    session_id: str,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
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
    current_events: list[Any] = _json_loads(row.events_json, [])
    row.events_json = _json_dumps([*(current_events if isinstance(current_events, list) else []), event], "[]")
    row.updated_at = utc_now_naive()
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return study_session_json(row)


def abandon_study_session(
    session: Session,
    session_id: str,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    ended_at = _parse_datetime(payload.get("ended_at")) or utc_now_naive()
    row.status = "abandoned"
    row.ended_at = ended_at
    row.completion_method = str(payload.get("completion_method") or "abandoned")
    row.updated_at = utc_now_naive()
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
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
    keyword: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
    sort_by: str = "started_at",
    sort_order: str = "desc",
    limit: int | None = None,
    offset: int = 0,
) -> list[dict[str, Any]]:
    query = _filtered_study_sessions_query(
        session,
        keyword=keyword,
        kind=kind,
        status=status,
        started_from=started_from,
        started_to=started_to,
    )
    sort_column = {
        "started_at": StudySession.started_at,
        "effective_seconds": StudySession.effective_seconds,
        "title": func.lower(StudySession.title),
    }.get(sort_by, StudySession.started_at)
    order = sort_column.asc() if sort_order == "asc" else sort_column.desc()
    query = query.order_by(order, StudySession.id.asc())
    if limit is not None:
        query = query.offset(max(0, offset)).limit(limit)
    rows = query.all()
    return [study_session_json(row) for row in rows]


def count_study_sessions(
    session: Session,
    *,
    keyword: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
) -> int:
    return _filtered_study_sessions_query(
        session,
        keyword=keyword,
        kind=kind,
        status=status,
        started_from=started_from,
        started_to=started_to,
    ).count()


def summarize_study_sessions_by_client_source(
    session: Session,
    *,
    keyword: str | None = None,
    kind: str | None = None,
    status: str | None = None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
) -> dict[str, int]:
    """Aggregate effective seconds for the current list filters by client source."""
    rows = (
        _filtered_study_sessions_query(
            session,
            keyword=keyword,
            kind=kind,
            status=status,
            started_from=started_from,
            started_to=started_to,
        )
        .with_entities(StudySession.effective_seconds, StudySession.summary_json)
        .all()
    )
    total = 0
    desktop = 0
    pwa = 0
    unknown = 0
    for effective_seconds, summary_json in rows:
        seconds = max(0, int(effective_seconds or 0))
        total += seconds
        source = _client_source_from_summary_json(summary_json)
        if source == "desktop":
            desktop += seconds
        elif source == "pwa":
            pwa += seconds
        else:
            unknown += seconds
    return {
        "total_effective_seconds": total,
        "desktop_effective_seconds": desktop,
        "pwa_effective_seconds": pwa,
        "unknown_effective_seconds": unknown,
    }


def _client_source_from_summary_json(raw: str | None) -> str | None:
    payload = _json_loads(raw, {})
    if not isinstance(payload, dict):
        return None
    value = str(payload.get("client_source") or "").strip().lower()
    if value == "desktop":
        return "desktop"
    if value in {"pwa", "mobile"}:
        return "pwa"
    return None


def _filtered_study_sessions_query(
    session: Session,
    *,
    keyword: str | None,
    kind: str | None,
    status: str | None,
    started_from: datetime | None = None,
    started_to: datetime | None = None,
) -> Query:
    query = session.query(StudySession).filter(StudySession.deleted_at.is_(None))
    if status:
        query = query.filter(StudySession.status == status)
    normalized_keyword = str(keyword or "").strip()
    if normalized_keyword:
        query = query.filter(StudySession.title.ilike(f"%{normalized_keyword}%"))
    if kind == "palace_edit":
        query = query.filter(StudySession.scene == "palace_edit")
    elif kind == "quiz":
        query = query.filter(StudySession.scene == "quiz")
    elif kind == "review":
        query = query.filter(StudySession.scene.in_(FORMAL_REVIEW_SCENES))
    elif kind == "custom":
        query = query.filter(StudySession.scene == "custom")
    elif kind == "practice":
        query = query.filter(
            StudySession.scene.notin_(
                ("palace_edit", "quiz", "custom", *FORMAL_REVIEW_SCENES)
            )
        )
    # Filter by session wall time: prefer started_at for "records in this range".
    if started_from is not None:
        query = query.filter(StudySession.started_at >= started_from)
    if started_to is not None:
        query = query.filter(StudySession.started_at < started_to)
    return query


from .study_session_bridge import (  # noqa: E402  (compatibility re-exports)
    create_completed_study_session_from_time_payload as create_completed_study_session_from_time_payload,
)
from .study_session_bridge import (  # noqa: E402  (compatibility re-exports)
    create_review_study_session as create_review_study_session,
)
from .study_session_bridge import (  # noqa: E402  (compatibility re-exports)
    ensure_review_log_study_sessions as ensure_review_log_study_sessions,
)
from .study_session_bridge import (  # noqa: E402  (compatibility re-exports)
    reclassify_ghost_formal_review_time_sessions as reclassify_ghost_formal_review_time_sessions,
)
