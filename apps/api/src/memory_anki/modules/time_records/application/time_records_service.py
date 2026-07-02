from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config, ReviewLog, TimeRecord
from memory_anki.modules.time_records.application.time_record_queries import (
    TIME_RECORD_DASHBOARD_KINDS,
    date_range_bounds,
    get_all_time_english_practice_duration_seconds,
    get_all_time_english_reading_duration_seconds,
    get_all_time_total_review_duration_seconds,
    get_english_course_stats,
    get_monthly_total_review_duration_seconds,
    get_selected_total_review_duration_seconds,
    get_threshold_seconds,
    get_time_record_duration_seconds,
    get_today_english_practice_duration_seconds,
    get_today_english_reading_duration_seconds,
    get_today_formal_review_duration_seconds,
    get_today_palace_learning_breakdown,
    get_today_total_review_duration_seconds,
    get_weekly_english_practice_duration_seconds,
    get_weekly_english_reading_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
    month_bounds,
)


def _normalize_record(record: TimeRecord) -> dict:
    payload = _parse_record_payload(record.events_json)
    return {
        "id": record.id,
        "kind": record.kind,
        "palaceId": record.palace_id,
        "palaceSegmentId": getattr(record, "palace_segment_id", None),
        "sourceKind": _resolve_source_kind(record),
        "englishCourseId": getattr(record, "english_course_id", None),
        "title": record.title,
        "startedAt": serialize_storage_datetime(record.started_at),
        "endedAt": serialize_storage_datetime(record.ended_at),
        "effectiveSeconds": record.effective_seconds,
        "pauseCount": record.pause_count,
        "completionMethod": record.completion_method,
        "durationEdited": bool(record.duration_edited),
        "deletedAt": serialize_storage_datetime(record.deleted_at) if record.deleted_at else None,
        "deletedReason": record.deleted_reason,
        "events": payload["events"],
        "sceneSegments": payload["sceneSegments"],
    }


def set_threshold_seconds(session: Session, seconds: int) -> int:
    safe_seconds = max(0, round(seconds))
    row = session.query(Config).filter_by(key="time_recording_threshold_seconds").first()
    if row is None:
        row = Config(key="time_recording_threshold_seconds", value=str(safe_seconds))
        session.add(row)
    else:
        row.value = str(safe_seconds)
    session.commit()
    return safe_seconds


def list_time_records(
    session: Session,
    include_deleted: bool = False,
    include_below_threshold: bool = False,
) -> list[dict]:
    query = session.query(TimeRecord).order_by(TimeRecord.started_at.desc())
    if not include_deleted:
        query = query.filter(TimeRecord.deleted_at.is_(None))
    records = [_normalize_record(record) for record in query.all()]
    if include_below_threshold:
        return records
    threshold = get_threshold_seconds(session)
    return [record for record in records if record["effectiveSeconds"] > threshold]


def create_time_record(session: Session, payload: dict) -> dict | None:
    threshold = get_threshold_seconds(session)
    effective_seconds = max(0, int(payload.get("effectiveSeconds", 0)))
    if effective_seconds <= threshold:
        return None
    started_at = parse_storage_datetime(payload.get("startedAt"))
    ended_at = parse_storage_datetime(payload.get("endedAt"))
    if started_at is None or ended_at is None:
        raise ValueError("开始时间和结束时间不能为空。")
    if started_at > ended_at:
        raise ValueError("开始时间不能晚于结束时间。")
    source_kind = _normalize_source_kind(
        payload.get("sourceKind"),
        palace_id=payload.get("palaceId"),
        english_course_id=payload.get("englishCourseId"),
    )
    record = TimeRecord(
        id=str(payload["id"]),
        kind=str(payload["kind"]),
        palace_id=payload.get("palaceId"),
        palace_segment_id=payload.get("palaceSegmentId"),
        source_kind=source_kind,
        english_course_id=payload.get("englishCourseId"),
        title=str(payload.get("title", "")),
        started_at=started_at,
        ended_at=ended_at,
        effective_seconds=effective_seconds,
        pause_count=max(0, int(payload.get("pauseCount", 0))),
        completion_method=str(payload.get("completionMethod", "manual_complete")),
        duration_edited=bool(payload.get("durationEdited", False)),
        deleted_reason=payload.get("deletedReason"),
        deleted_at=parse_optional_storage_datetime(payload.get("deletedAt")),
        events_json=_serialize_record_payload(
            payload.get("events", []),
            payload.get("sceneSegments", []),
        ),
    )
    persistent_record = session.merge(record)
    session.commit()
    session.refresh(persistent_record)
    return _normalize_record(persistent_record)


def update_time_record(session: Session, record_id: str, updater: dict) -> dict | None:
    record = session.query(TimeRecord).filter_by(id=record_id).first()
    if record is None:
        return None

    mapping: dict[str, tuple[str, Callable[[Any], Any]]] = {
        "kind": ("kind", str),
        "palaceId": ("palace_id", lambda value: value),
        "palaceSegmentId": ("palace_segment_id", lambda value: value),
        "englishCourseId": ("english_course_id", lambda value: value),
        "title": ("title", str),
        "startedAt": ("started_at", parse_storage_datetime),
        "endedAt": ("ended_at", parse_storage_datetime),
        "effectiveSeconds": ("effective_seconds", lambda value: max(0, int(value))),
        "pauseCount": ("pause_count", lambda value: max(0, int(value))),
        "completionMethod": ("completion_method", str),
        "durationEdited": ("duration_edited", bool),
        "deletedReason": ("deleted_reason", lambda value: value),
        "deletedAt": ("deleted_at", parse_optional_storage_datetime),
        "events": ("events_json", lambda value: _serialize_record_payload(value, _parse_record_payload(record.events_json)["sceneSegments"])),
    }
    for key, (field, transform) in mapping.items():
        if key in updater:
            setattr(record, field, transform(updater[key]))
    if "sceneSegments" in updater:
        record.events_json = _serialize_record_payload(
            _parse_record_payload(record.events_json)["events"],
            updater.get("sceneSegments", []),
        )
    if "sourceKind" in updater:
        record.source_kind = _normalize_source_kind(
            updater.get("sourceKind"),
            palace_id=record.palace_id,
            english_course_id=getattr(record, "english_course_id", None),
        )

    if record.started_at is None or record.ended_at is None:
        raise ValueError("开始时间和结束时间不能为空。")
    if record.started_at > record.ended_at:
        raise ValueError("开始时间不能晚于结束时间。")

    session.commit()
    session.refresh(record)
    return _normalize_record(record)


def soft_delete_time_record(session: Session, record_id: str) -> dict | None:
    return update_time_record(
        session,
        record_id,
        {"deletedAt": serialize_storage_datetime(datetime.now()), "deletedReason": "manual"},
    )


def restore_time_record(session: Session, record_id: str) -> dict | None:
    return update_time_record(session, record_id, {"deletedAt": None, "deletedReason": None})


def import_legacy_time_records(
    session: Session,
    records: list[dict],
    clear_existing: bool = False,
) -> int:
    if clear_existing:
        session.query(TimeRecord).delete()
        session.commit()
    imported = 0
    for item in records:
        try:
            created = create_time_record(session, item)
            if created is not None:
                imported += 1
        except Exception:
            session.rollback()
    return imported


def ensure_review_log_time_records(session: Session) -> int:
    review_logs = (
        session.query(ReviewLog)
        .filter(ReviewLog.duration_seconds > 0)
        .order_by(ReviewLog.id.asc())
        .all()
    )
    active_review_records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.kind == "review",
            TimeRecord.deleted_at.is_(None),
        )
        .all()
    )
    records_by_group: dict[tuple[int | None, date, int], list[TimeRecord]] = defaultdict(list)
    for record in active_review_records:
        records_by_group[_review_record_group_key(record)].append(record)

    logs_by_group: dict[tuple[int | None, date, int], list[ReviewLog]] = defaultdict(list)
    for log in review_logs:
        logs_by_group[_review_log_group_key(log)].append(log)

    created_count = 0
    for group_key, group_logs in logs_by_group.items():
        candidate_records = sorted(
            records_by_group.get(group_key, []),
            key=_review_record_preference_key,
        )
        desired_count = len(group_logs)
        kept_records = candidate_records[:desired_count]
        for duplicate_record in candidate_records[desired_count:]:
            duplicate_record.deleted_at = datetime.now()
            duplicate_record.deleted_reason = "migration_dedup"

        covered_stable_ids = {
            record.id
            for record in kept_records
            if record.id.startswith("review-log-")
        }
        covered_nonstable_count = len(kept_records) - len(covered_stable_ids)
        for log in group_logs:
            stable_record_id = f"review-log-{log.id}"
            if stable_record_id in covered_stable_ids:
                continue
            if covered_nonstable_count > 0:
                covered_nonstable_count -= 1
                continue
            created = _ensure_review_log_time_record(session, log)
            if created is not None:
                created_count += 1
    session.commit()
    return created_count


def normalize_time_record_event_timezones(session: Session) -> int:
    records = session.query(TimeRecord).order_by(TimeRecord.started_at.asc()).all()
    updated_count = 0
    for record in records:
        events = _parse_events(record.events_json)
        start_event = _find_event_time(events, {"start"}) if events else None
        end_event = _find_event_time(
            events,
            {"manual_complete", "auto_complete", "complete", "saved", "left_page", "restart"},
            fallback="last",
        ) if events else None
        next_started_at = _normalize_stored_event_datetime(record.started_at, start_event)
        next_ended_at = _normalize_stored_event_datetime(record.ended_at, end_event)
        if next_started_at is None:
            next_started_at = record.started_at
        if next_ended_at is None:
            next_ended_at = record.ended_at
        next_started_at, next_ended_at = _repair_shifted_record_bounds(
            record,
            next_started_at,
            next_ended_at,
            start_event,
            end_event,
        )
        if next_started_at == record.started_at and next_ended_at == record.ended_at:
            continue
        record.started_at = next_started_at
        record.ended_at = next_ended_at
        updated_count += 1
    session.commit()
    return updated_count


def create_review_time_record(
    session: Session,
    *,
    record_id: str,
    title: str,
    palace_id: int | None,
    palace_segment_id: int | None = None,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
    duration_seconds: int,
    completion_method: str = "auto_complete",
) -> dict | None:
    threshold = get_threshold_seconds(session)
    effective_seconds = max(0, int(duration_seconds))
    if effective_seconds <= threshold:
        return None
    if ended_at is None and started_at is None:
        raise ValueError("started_at 或 ended_at 至少需要提供一个。")
    resolved_started_at = started_at or (ended_at - timedelta(seconds=effective_seconds))
    resolved_ended_at = ended_at or (resolved_started_at + timedelta(seconds=effective_seconds))
    record = TimeRecord(
        id=record_id,
        kind="review",
        palace_id=palace_id,
        palace_segment_id=palace_segment_id,
        source_kind="palace" if palace_id is not None else None,
        title=title,
        started_at=resolved_started_at,
        ended_at=resolved_ended_at,
        effective_seconds=effective_seconds,
        pause_count=0,
        completion_method=completion_method,
        duration_edited=False,
        deleted_reason=None,
        deleted_at=None,
        events_json="[]",
    )
    persistent_record = session.merge(record)
    session.flush()
    return _normalize_record(persistent_record)


def serialize_storage_datetime(value: datetime) -> str:
    return normalize_storage_datetime(value).isoformat()


def parse_storage_datetime(raw: Any) -> datetime | None:
    if raw in (None, ""):
        return None
    parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    return normalize_storage_datetime(parsed)


def parse_optional_storage_datetime(raw: Any) -> datetime | None:
    if raw in (None, ""):
        return None
    return parse_storage_datetime(raw)


def normalize_storage_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=None)
    return value.astimezone().replace(tzinfo=None)


def _parse_events(raw: str | None) -> list[dict[str, Any]]:
    return _parse_record_payload(raw)["events"]


def _parse_record_payload(raw: str | None) -> dict[str, list[dict[str, Any]]]:
    if not raw:
        return {"events": [], "sceneSegments": []}
    data = json.loads(raw)
    if isinstance(data, list):
        return {"events": data, "sceneSegments": []}
    if isinstance(data, dict):
        events = data.get("events")
        scene_segments = data.get("sceneSegments")
        return {
            "events": events if isinstance(events, list) else [],
            "sceneSegments": scene_segments if isinstance(scene_segments, list) else [],
        }
    return {"events": [], "sceneSegments": []}


def _serialize_record_payload(
    events: Any,
    scene_segments: Any,
) -> str:
    return json.dumps(
        {
            "events": events if isinstance(events, list) else [],
            "sceneSegments": scene_segments if isinstance(scene_segments, list) else [],
        },
        ensure_ascii=False,
    )


def _find_event_time(
    events: list[dict[str, Any]],
    accepted_types: set[str],
    *,
    fallback: str = "first",
) -> datetime | None:
    iterable = reversed(events) if fallback == "last" else events
    for event in iterable:
        if str(event.get("type") or "") not in accepted_types:
            continue
        parsed = _parse_event_datetime(event.get("at"))
        if parsed is not None:
            return parsed
    if fallback == "last":
        for event in reversed(events):
            parsed = _parse_event_datetime(event.get("at"))
            if parsed is not None:
                return parsed
    return None


def _parse_event_datetime(raw: Any) -> datetime | None:
    if raw in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def _normalize_stored_event_datetime(
    stored: datetime | None,
    event_time: datetime | None,
) -> datetime | None:
    if stored is None or event_time is None:
        return None
    local_naive = event_time.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
    if _is_whole_day_shift(stored, local_naive):
        return stored
    event_utc_naive = event_time.astimezone(timezone.utc).replace(tzinfo=None)
    if abs((stored - event_utc_naive).total_seconds()) <= 60:
        return local_naive
    normalized_local = local_naive.replace(second=0, microsecond=0)
    if abs((stored - normalized_local).total_seconds()) <= 60:
        return stored
    return normalized_local


def _repair_shifted_record_bounds(
    record: TimeRecord,
    started_at: datetime,
    ended_at: datetime,
    start_event: datetime | None,
    end_event: datetime | None,
) -> tuple[datetime, datetime]:
    if started_at > ended_at:
        started_at, ended_at = ended_at, started_at

    if start_event is not None and end_event is not None:
        expected_start = _normalize_stored_event_datetime(started_at, start_event)
        expected_end = end_event.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
        if expected_start is None or expected_end is None:
            return started_at, ended_at
        if expected_start <= expected_end:
            if _needs_duration_repair(started_at, ended_at, record.effective_seconds) and _matches_expected_elapsed(expected_start, expected_end, record.effective_seconds):
                return expected_start, expected_end

    if (
        started_at <= ended_at
        and not record.duration_edited
        and record.pause_count == 0
        and _needs_duration_repair(started_at, ended_at, record.effective_seconds)
    ):
        corrected_end = started_at + timedelta(seconds=max(0, int(record.effective_seconds)))
        return started_at, corrected_end

    return started_at, ended_at


def _is_whole_day_shift(
    stored: datetime,
    expected: datetime,
    tolerance_seconds: int = 120,
) -> bool:
    delta_seconds = abs((stored - expected).total_seconds())
    whole_days = round(delta_seconds / 86400)
    if whole_days == 0:
        return False
    if whole_days > 31:
        return False
    return abs(delta_seconds - (whole_days * 86400)) <= tolerance_seconds


def _needs_duration_repair(
    started_at: datetime,
    ended_at: datetime,
    effective_seconds: int,
    tolerance_seconds: int = 120,
) -> bool:
    delta_seconds = max(0.0, (ended_at - started_at).total_seconds())
    expected_seconds = max(0, int(effective_seconds))
    if abs(delta_seconds - expected_seconds) <= tolerance_seconds:
        return False
    whole_days = round(delta_seconds / 86400)
    if whole_days == 0:
        return False
    shifted_seconds = abs(delta_seconds - (whole_days * 86400))
    if shifted_seconds > 43200:
        shifted_seconds = abs(delta_seconds - ((whole_days + 1) * 86400))
    return (
        shifted_seconds <= tolerance_seconds
        or abs(shifted_seconds - expected_seconds) <= tolerance_seconds
    )


def _matches_expected_elapsed(
    started_at: datetime,
    ended_at: datetime,
    effective_seconds: int,
    tolerance_seconds: int = 120,
) -> bool:
    actual_seconds = max(0.0, (ended_at - started_at).total_seconds())
    return abs(actual_seconds - max(0, int(effective_seconds))) <= tolerance_seconds


def _ensure_review_log_time_record(session: Session, log: ReviewLog) -> dict | None:
    record_id = f"review-log-{log.id}"
    existing = session.query(TimeRecord).filter_by(id=record_id).first()
    if existing is not None:
        return None
    return create_review_time_record(
        session,
        record_id=record_id,
        title=log.palace.title if log.palace and log.palace.title else "复习",
        palace_id=log.palace_id,
        started_at=datetime.combine(log.review_date or date.today(), datetime.min.time()),
        duration_seconds=max(0, int(log.duration_seconds or 0)),
    )


def _review_log_group_key(log: ReviewLog) -> tuple[int | None, date, int]:
    return (log.palace_id, log.review_date or date.today(), max(0, int(log.duration_seconds)))


def _review_record_group_key(record: TimeRecord) -> tuple[int | None, date, int]:
    return (record.palace_id, record.started_at.date(), max(0, int(record.effective_seconds)))


def _review_record_preference_key(record: TimeRecord) -> tuple[int, datetime]:
    if not _is_generated_review_time_record_id(record.id) and not _has_session_events(record):
        return (0, record.started_at)
    if _is_generated_review_time_record_id(record.id):
        return (1, record.started_at)
    return (2, record.started_at)


def _is_generated_review_time_record_id(record_id: str) -> bool:
    return record_id.startswith("review-log-") or record_id.startswith("segment-review-log-")


def _has_session_events(record: TimeRecord) -> bool:
    return len(_parse_events(record.events_json)) > 0


def _normalize_source_kind(
    raw: Any,
    *,
    palace_id: Any = None,
    english_course_id: Any = None,
) -> str | None:
    if raw in {"palace", "english", "english_reading"}:
        return raw
    if english_course_id is not None:
        return "english"
    if palace_id is not None:
        return "palace"
    return None


def _resolve_source_kind(record: TimeRecord) -> str | None:
    return _normalize_source_kind(
        getattr(record, "source_kind", None),
        palace_id=record.palace_id,
        english_course_id=getattr(record, "english_course_id", None),
    )
