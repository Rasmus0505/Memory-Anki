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
from .study_session_duration import (
    normalize_effective_seconds,
    should_ignore_terminal_write,
    write_metadata,
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
from .time_record_read_model import (
    build_time_record_read_model as build_time_record_read_model,
)
from .time_record_read_model import (
    count_time_records as count_time_records,
)
from .time_record_read_model import (
    get_time_record_daily_totals as get_time_record_daily_totals,
)
from .time_record_read_model import (
    get_time_record_duration_seconds as get_time_record_duration_seconds,
)
from .time_record_read_model import (
    time_record_kind as time_record_kind,
)
from .time_record_read_model import (
    valid_time_records_query as valid_time_records_query,
)


def _duration_edited(payload: dict[str, Any], summary: dict[str, Any] | None = None) -> bool:
    """Read the explicit user-duration override used by timer payloads."""

    for key in ("duration_edited", "durationEdited"):
        if key in payload:
            value = payload.get(key)
            if isinstance(value, str):
                return value.strip().lower() in {"1", "true", "yes", "on"}
            return bool(value)
    summary_payload = summary if isinstance(summary, dict) else payload.get("summary")
    if not isinstance(summary_payload, dict):
        return False
    value = summary_payload.get("duration_edited", summary_payload.get("durationEdited"))
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _incoming_completion_method(payload: dict[str, Any], default: str = "") -> str:
    return str(payload.get("completion_method") or payload.get("completionMethod") or default)


_PAYLOAD_ALIASES = {
    "sessionKey": "session_key",
    "clientRevision": "client_revision",
    "operationId": "operation_id",
    "startedAt": "started_at",
    "endedAt": "ended_at",
    "effectiveSeconds": "effective_seconds",
    "idleSeconds": "idle_seconds",
    "pauseCount": "pause_count",
    "completionMethod": "completion_method",
    "durationEdited": "duration_edited",
}


def _canonical_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    for legacy_name, canonical_name in _PAYLOAD_ALIASES.items():
        if canonical_name not in normalized and legacy_name in normalized:
            normalized[canonical_name] = normalized[legacy_name]
    return normalized


def _duration_input(payload: dict[str, Any], default: int = 0) -> object:
    return payload.get("effective_seconds", default)


def _summary_with_duration_edit(
    summary: dict[str, Any],
    *,
    duration_edited: bool,
) -> dict[str, Any]:
    if not duration_edited:
        return summary
    return {**summary, "duration_edited": True}


def create_study_session(
    session: Session,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any]:
    payload = _canonical_payload(payload)
    now = utc_now_naive()
    session_id = str(payload.get("id") or uuid4())
    raw_started_at = payload.get("started_at")
    started_at = _parse_datetime(raw_started_at)
    if started_at is None:
        if "started_at" in payload and raw_started_at not in (None, ""):
            raise ValueError("开始时间格式无效。")
        started_at = now
    raw_ended_at = payload.get("ended_at")
    ended_at = _parse_datetime(raw_ended_at)
    if ended_at is None and "ended_at" in payload and raw_ended_at not in (None, ""):
        raise ValueError("结束时间格式无效。")
    if started_at is not None and ended_at is not None and started_at > ended_at:
        raise ValueError("开始时间不能晚于结束时间。")
    status = _normalize_status(payload.get("status"))
    completion_method = _incoming_completion_method(payload)
    session_key, client_revision, operation_id = write_metadata(payload)
    raw_summary = payload.get("summary")
    summary_payload = raw_summary if isinstance(raw_summary, dict) else {}
    duration_edited = _duration_edited(payload, summary_payload)
    effective_seconds = normalize_effective_seconds(
        _duration_input(payload),
        started_at=started_at,
        ended_at=ended_at if status == "completed" else None,
        duration_edited=duration_edited,
        now=now,
    )
    existing = session.query(StudySession).filter_by(id=session_id).first()
    if existing is None and session_key is not None:
        # A legacy snapshot may have lost its record id during migration. Bind
        # its first write to the still-open target session instead of creating
        # a second final record for the same learning target.
        existing = (
            session.query(StudySession)
            .filter(
                StudySession.session_key == session_key,
                StudySession.status.in_(ACTIVE_STATUSES),
                StudySession.deleted_at.is_(None),
            )
            .order_by(StudySession.updated_at.desc(), StudySession.started_at.desc())
            .first()
        )
    if existing is not None:
        # A create call can be a replayed checkpoint. Missing fields must keep
        # the stored values; otherwise a sparse retry would erase progress.
        if "status" not in payload:
            status = existing.status
        if "completion_method" not in payload:
            completion_method = existing.completion_method
        if "started_at" not in payload:
            started_at = existing.started_at
        if "ended_at" not in payload:
            ended_at = existing.ended_at
        if started_at is not None and ended_at is not None and started_at > ended_at:
            raise ValueError("开始时间不能晚于结束时间。")
        if "effective_seconds" not in payload:
            # A sparse retry is not a duration write. Preserve a historical
            # value exactly, including a value explicitly edited by the user;
            # re-capping it here would silently rewrite old records.
            effective_seconds = int(existing.effective_seconds or 0)
    if existing is not None:
        if should_ignore_terminal_write(
            existing_status=existing.status,
            existing_completion_method=existing.completion_method,
            incoming_status=status,
            incoming_completion_method=completion_method,
            existing_effective_seconds=int(existing.effective_seconds or 0),
            incoming_effective_seconds=effective_seconds,
            incoming_duration_edited=duration_edited,
            existing_client_revision=int(existing.client_revision or 0),
            incoming_client_revision=client_revision,
            existing_operation_id=existing.last_operation_id,
            incoming_operation_id=operation_id,
        ):
            return study_session_json(existing)
        # A newer create/checkpoint for the same client id updates the existing
        # row in place.  ``merge`` would reset fields omitted by the checkpoint.
        if "status" in payload:
            existing.status = status
        if "scene" in payload:
            existing.scene = _normalize_scene(payload.get("scene"))
        for field, converter in (
            ("target_type", _normalize_target_type),
            ("target_id", _int_or_none),
            ("palace_id", _int_or_none),
            ("palace_segment_id", _int_or_none),
            ("mini_palace_id", _int_or_none),
            ("english_course_id", _int_or_none),
            ("english_reading_material_id", _int_or_none),
        ):
            if field in payload:
                setattr(existing, field, converter(payload.get(field)))
        if "title" in payload:
            existing.title = str(payload.get("title") or "")
        if "started_at" in payload:
            parsed_started = _parse_datetime(payload.get("started_at"))
            if parsed_started is not None:
                existing.started_at = parsed_started
        if "ended_at" in payload:
            existing.ended_at = (
                _parse_datetime(payload.get("ended_at"))
                if status == "completed"
                else None
            )
        existing.effective_seconds = effective_seconds
        if "idle_seconds" in payload:
            existing.idle_seconds = max(0, int(payload.get("idle_seconds") or 0))
        if "pause_count" in payload:
            existing.pause_count = max(0, int(payload.get("pause_count") or 0))
        if "completion_method" in payload:
            existing.completion_method = completion_method
        if "progress" in payload:
            existing.progress_json = _json_dumps(payload.get("progress") or {}, "{}")
        if "events" in payload:
            existing.events_json = _json_dumps(payload.get("events") or [], "[]")
        if "summary" in payload or duration_edited:
            current_summary: dict[str, Any] = _json_loads(existing.summary_json, {})
            if not isinstance(current_summary, dict):
                current_summary = {}
            existing.summary_json = _json_dumps(
                {**current_summary, **_summary_with_duration_edit(summary_payload, duration_edited=duration_edited)},
                "{}",
            )
        if session_key is not None:
            existing.session_key = session_key
        if client_revision is not None:
            # Keep the server-side revision monotonic even when an explicit
            # history edit is based on an older revision.
            existing.client_revision = max(int(existing.client_revision or 0), client_revision)
        if operation_id is not None:
            existing.last_operation_id = operation_id
        existing.updated_at = now
        if commit:
            session.commit()
            session.refresh(existing)
        else:
            session.flush()
        return study_session_json(existing)
    summary_payload = _summary_with_duration_edit(summary_payload, duration_edited=duration_edited)
    row = StudySession(
        id=session_id,
        session_key=session_key,
        client_revision=client_revision or 0,
        last_operation_id=operation_id,
        status=status,
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
        ended_at=ended_at if status == "completed" else None,
        effective_seconds=effective_seconds,
        idle_seconds=max(0, int(payload.get("idle_seconds") or 0)),
        pause_count=max(0, int(payload.get("pause_count") or 0)),
        completion_method=completion_method,
        progress_json=_json_dumps(payload.get("progress") or {}, "{}"),
        events_json=_json_dumps(payload.get("events") or [{"type": "start", "at": started_at.isoformat()}], "[]"),
        summary_json=_json_dumps(summary_payload, "{}"),
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
    payload = _canonical_payload(payload)
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    current_summary: dict[str, Any] = _json_loads(row.summary_json, {})
    if not isinstance(current_summary, dict):
        current_summary = {}
    raw_summary = payload.get("summary")
    next_summary = raw_summary if isinstance(raw_summary, dict) else {}
    merged_summary = {**current_summary, **next_summary}
    incoming_status = (
        _normalize_status(payload.get("status"), row.status)
        if "status" in payload
        else row.status
    )
    incoming_completion_method = (
        _incoming_completion_method(payload, row.completion_method)
        if "completion_method" in payload or "completionMethod" in payload
        else row.completion_method
    )
    incoming_started_at = row.started_at
    if "started_at" in payload:
        parsed = _parse_datetime(payload.get("started_at"))
        if parsed is None and payload.get("started_at") not in (None, ""):
            raise ValueError("开始时间格式无效。")
        if parsed is not None:
            incoming_started_at = parsed
    incoming_ended_at = row.ended_at
    if "ended_at" in payload:
        parsed = _parse_datetime(payload.get("ended_at"))
        if parsed is None and payload.get("ended_at") not in (None, ""):
            raise ValueError("结束时间格式无效。")
        incoming_ended_at = parsed
    has_duration_write = "effective_seconds" in payload
    incoming_effective_seconds = (
        max(0, int(payload.get("effective_seconds") or 0))
        if has_duration_write
        else int(row.effective_seconds or 0)
    )
    # Only an explicit flag on this request can opt out of the wall-clock cap.
    # Do not inherit ``duration_edited`` from the stored summary: a late timer
    # write must never turn a prior manual edit into a bypass token.
    duration_edited = _duration_edited(payload, next_summary)
    if (
        incoming_started_at is not None
        and incoming_ended_at is not None
        and incoming_started_at > incoming_ended_at
    ):
        raise ValueError("开始时间不能晚于结束时间。")
    if has_duration_write:
        incoming_effective_seconds = normalize_effective_seconds(
            incoming_effective_seconds,
            started_at=incoming_started_at,
            ended_at=incoming_ended_at if incoming_status == "completed" else None,
            duration_edited=duration_edited,
            now=utc_now_naive(),
        )
    if should_ignore_terminal_write(
        existing_status=row.status,
        existing_completion_method=row.completion_method,
        incoming_status=incoming_status,
        incoming_completion_method=incoming_completion_method,
        existing_effective_seconds=int(row.effective_seconds or 0),
        incoming_effective_seconds=incoming_effective_seconds,
        incoming_duration_edited=duration_edited,
        existing_client_revision=int(row.client_revision or 0),
        incoming_client_revision=write_metadata(payload)[1],
        existing_operation_id=row.last_operation_id,
        incoming_operation_id=write_metadata(payload)[2],
    ):
        return study_session_json(row)
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
        "effective_seconds": ("effective_seconds", lambda value: incoming_effective_seconds),
        "idle_seconds": ("idle_seconds", lambda value: max(0, int(value or 0))),
        "pause_count": ("pause_count", lambda value: max(0, int(value or 0))),
        "completion_method": ("completion_method", str),
    }
    for key, (field, transform) in mapping.items():
        if key in payload:
            setattr(row, field, transform(payload[key]))
    if "started_at" in payload:
        parsed = _parse_datetime(payload.get("started_at"))
        if parsed is None and payload.get("started_at") not in (None, ""):
            raise ValueError("开始时间格式无效。")
        if parsed is not None:
            row.started_at = parsed
    if "ended_at" in payload:
        row.ended_at = incoming_ended_at if incoming_status == "completed" else None
    if "progress" in payload:
        row.progress_json = _json_dumps(payload.get("progress") or {}, "{}")
    if "summary" in payload:
        row.summary_json = _json_dumps(merged_summary, "{}")
    if "events" in payload:
        row.events_json = _json_dumps(payload.get("events") or [], "[]")
    if duration_edited:
        row.summary_json = _json_dumps({**merged_summary, "duration_edited": True}, "{}")
    session_key, client_revision, operation_id = write_metadata(payload)
    if session_key is not None:
        row.session_key = session_key
    if client_revision is not None:
        row.client_revision = max(int(row.client_revision or 0), client_revision)
    if operation_id is not None:
        row.last_operation_id = operation_id
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
    payload = _canonical_payload(payload)
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    raw_ended_at = payload.get("ended_at")
    ended_at = _parse_datetime(raw_ended_at)
    if ended_at is None:
        if "ended_at" in payload and raw_ended_at not in (None, ""):
            raise ValueError("结束时间格式无效。")
        ended_at = utc_now_naive()
    raw_summary = payload.get("summary")
    summary_payload = raw_summary if isinstance(raw_summary, dict) else {}
    current_summary: dict[str, Any] = _json_loads(row.summary_json, {})
    if not isinstance(current_summary, dict):
        current_summary = {}
    merged_summary = {**current_summary, **summary_payload}
    completion_method = _incoming_completion_method(
        payload, row.completion_method or "manual_complete"
    )
    duration_edited = _duration_edited(payload, summary_payload)
    session_key, client_revision, operation_id = write_metadata(payload)
    effective_seconds = normalize_effective_seconds(
        payload.get("effective_seconds", row.effective_seconds or 0),
        started_at=row.started_at,
        ended_at=ended_at,
        duration_edited=duration_edited,
        now=utc_now_naive(),
    )
    if should_ignore_terminal_write(
        existing_status=row.status,
        existing_completion_method=row.completion_method,
        incoming_status="completed",
        incoming_completion_method=completion_method,
        existing_effective_seconds=int(row.effective_seconds or 0),
        incoming_effective_seconds=effective_seconds,
        incoming_duration_edited=duration_edited,
        existing_client_revision=int(row.client_revision or 0),
        incoming_client_revision=client_revision,
        existing_operation_id=row.last_operation_id,
        incoming_operation_id=operation_id,
    ):
        return study_session_json(row)
    row.status = "completed"
    row.ended_at = ended_at
    row.effective_seconds = effective_seconds
    row.idle_seconds = max(0, int(payload.get("idle_seconds", row.idle_seconds or 0)))
    row.pause_count = max(0, int(payload.get("pause_count", row.pause_count or 0)))
    row.completion_method = completion_method
    if "progress" in payload:
        row.progress_json = _json_dumps(payload.get("progress") or {}, "{}")
    if "summary" in payload:
        row.summary_json = _json_dumps(
            _summary_with_duration_edit(merged_summary, duration_edited=duration_edited),
            "{}",
        )
    elif duration_edited:
        row.summary_json = _json_dumps({**merged_summary, "duration_edited": True}, "{}")
    if session_key is not None:
        row.session_key = session_key
    if client_revision is not None:
        row.client_revision = max(int(row.client_revision or 0), client_revision)
    if operation_id is not None:
        row.last_operation_id = operation_id
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
    payload = _canonical_payload(payload)
    row = session.query(StudySession).filter_by(id=session_id).first()
    if row is None:
        return None
    raw_ended_at = payload.get("ended_at")
    ended_at = _parse_datetime(raw_ended_at)
    if ended_at is None:
        if "ended_at" in payload and raw_ended_at not in (None, ""):
            raise ValueError("结束时间格式无效。")
        ended_at = utc_now_naive()
    current_summary: dict[str, Any] = _json_loads(row.summary_json, {})
    if not isinstance(current_summary, dict):
        current_summary = {}
    duration_edited = _duration_edited(payload)
    session_key, client_revision, operation_id = write_metadata(payload)
    effective_seconds = normalize_effective_seconds(
        row.effective_seconds or 0,
        started_at=row.started_at,
        ended_at=ended_at,
        duration_edited=duration_edited,
        now=utc_now_naive(),
    )
    completion_method = str(payload.get("completion_method") or "abandoned")
    if should_ignore_terminal_write(
        existing_status=row.status,
        existing_completion_method=row.completion_method,
        incoming_status="abandoned",
        incoming_completion_method=completion_method,
        existing_effective_seconds=int(row.effective_seconds or 0),
        incoming_effective_seconds=effective_seconds,
        incoming_duration_edited=duration_edited,
        existing_client_revision=int(row.client_revision or 0),
        incoming_client_revision=client_revision,
        existing_operation_id=row.last_operation_id,
        incoming_operation_id=operation_id,
    ):
        return study_session_json(row)
    row.status = "abandoned"
    row.ended_at = ended_at
    row.effective_seconds = effective_seconds
    row.completion_method = completion_method
    if session_key is not None:
        row.session_key = session_key
    if client_revision is not None:
        row.client_revision = max(int(row.client_revision or 0), client_revision)
    if operation_id is not None:
        row.last_operation_id = operation_id
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
    payload: Any = _json_loads(raw, {})
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
