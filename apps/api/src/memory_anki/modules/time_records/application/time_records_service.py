from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config, ReviewLog, TimeRecord

TIME_RECORD_DASHBOARD_KINDS = ("review", "practice", "palace_edit")


def _normalize_record(record: TimeRecord) -> dict:
    return {
        "id": record.id,
        "kind": record.kind,
        "palaceId": record.palace_id,
        "palaceSegmentId": getattr(record, "palace_segment_id", None),
        "title": record.title,
        "startedAt": serialize_storage_datetime(record.started_at),
        "endedAt": serialize_storage_datetime(record.ended_at),
        "effectiveSeconds": record.effective_seconds,
        "pauseCount": record.pause_count,
        "completionMethod": record.completion_method,
        "durationEdited": bool(record.duration_edited),
        "deletedAt": serialize_storage_datetime(record.deleted_at) if record.deleted_at else None,
        "deletedReason": record.deleted_reason,
        "events": json.loads(record.events_json or "[]"),
    }


def get_threshold_seconds(session: Session) -> int:
    row = session.query(Config).filter_by(key="time_recording_threshold_seconds").first()
    if row is None:
        return 0
    try:
        return max(0, int(row.value))
    except Exception:
        return 0


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


def list_time_records(session: Session, include_deleted: bool = False, include_below_threshold: bool = False) -> list[dict]:
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
    record = TimeRecord(
        id=str(payload["id"]),
        kind=str(payload["kind"]),
        palace_id=payload.get("palaceId"),
        palace_segment_id=payload.get("palaceSegmentId"),
        title=str(payload.get("title", "")),
        started_at=started_at,
        ended_at=ended_at,
        effective_seconds=effective_seconds,
        pause_count=max(0, int(payload.get("pauseCount", 0))),
        completion_method=str(payload.get("completionMethod", "manual_complete")),
        duration_edited=bool(payload.get("durationEdited", False)),
        deleted_reason=payload.get("deletedReason"),
        deleted_at=parse_optional_storage_datetime(payload.get("deletedAt")),
        events_json=json.dumps(payload.get("events", []), ensure_ascii=False),
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
        "title": ("title", str),
        "startedAt": ("started_at", parse_storage_datetime),
        "endedAt": ("ended_at", parse_storage_datetime),
        "effectiveSeconds": ("effective_seconds", lambda value: max(0, int(value))),
        "pauseCount": ("pause_count", lambda value: max(0, int(value))),
        "completionMethod": ("completion_method", str),
        "durationEdited": ("duration_edited", bool),
        "deletedReason": ("deleted_reason", lambda value: value),
        "deletedAt": ("deleted_at", parse_optional_storage_datetime),
        "events": ("events_json", lambda value: json.dumps(value, ensure_ascii=False)),
    }
    for key, (field, transform) in mapping.items():
        if key in updater:
            setattr(record, field, transform(updater[key]))

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


def import_legacy_time_records(session: Session, records: list[dict], clear_existing: bool = False) -> int:
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
            key=_review_record_sort_key,
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
            start_event=start_event,
            end_event=end_event,
        )
        if next_started_at == record.started_at and next_ended_at == record.ended_at:
            continue
        record.started_at = next_started_at
        record.ended_at = next_ended_at
        updated_count += 1
    if updated_count > 0:
        session.commit()
    return updated_count


def create_review_time_record(
    session: Session,
    *,
    record_id: str,
    palace_id: int | None,
    palace_segment_id: int | None,
    title: str,
    duration_seconds: int,
    ended_at: datetime,
    completion_method: str = "manual_complete",
) -> dict | None:
    safe_duration = max(0, int(duration_seconds))
    threshold = get_threshold_seconds(session)
    if safe_duration <= threshold:
        return None
    normalized_ended_at = normalize_storage_datetime(ended_at)
    started_at = normalized_ended_at - timedelta(seconds=safe_duration)
    record = TimeRecord(
        id=record_id,
        kind="review",
        palace_id=palace_id,
        palace_segment_id=palace_segment_id,
        title=title,
        started_at=started_at,
        ended_at=normalized_ended_at,
        effective_seconds=safe_duration,
        pause_count=0,
        completion_method=completion_method or "manual_complete",
        duration_edited=False,
        deleted_reason=None,
        deleted_at=None,
        events_json="[]",
    )
    persistent_record = session.merge(record)
    session.flush()
    return _normalize_record(persistent_record)


def get_today_total_review_duration_seconds(session: Session) -> int:
    today = date.today()
    start = datetime.combine(today, time.min)
    end = start + timedelta(days=1)
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_today_formal_review_duration_seconds(session: Session) -> int:
    today = date.today()
    start = datetime.combine(today, time.min)
    end = start + timedelta(days=1)
    return get_time_record_duration_seconds(
        session,
        kinds=("review",),
        start=start,
        end=end,
    )


def get_weekly_total_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_monthly_total_review_duration_seconds(session: Session) -> int:
    start, end = _current_month_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_selected_total_review_duration_seconds(
    session: Session,
    *,
    start: datetime,
    end: datetime,
) -> int:
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_all_time_total_review_duration_seconds(session: Session) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(TIME_RECORD_DASHBOARD_KINDS),
            TimeRecord.effective_seconds > threshold,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def get_weekly_formal_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("review",),
        start=start,
        end=end,
    )


def get_today_palace_learning_breakdown(session: Session) -> list[dict[str, Any]]:
    today = date.today()
    start = datetime.combine(today, time.min)
    end = start + timedelta(days=1)
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(TIME_RECORD_DASHBOARD_KINDS),
            TimeRecord.effective_seconds > threshold,
            TimeRecord.palace_id.is_not(None),
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .order_by(TimeRecord.started_at.asc(), TimeRecord.id.asc())
        .all()
    )

    grouped: dict[int, dict[str, Any]] = {}
    for record in records:
        palace_id = int(record.palace_id)
        payload = grouped.setdefault(
            palace_id,
            {
                "palace_id": palace_id,
                "palace_title": record.title or "未命名宫殿",
                "total_seconds": 0,
                "review_seconds": 0,
                "practice_seconds": 0,
                "palace_edit_seconds": 0,
            },
        )
        seconds = max(0, int(record.effective_seconds or 0))
        payload["total_seconds"] += seconds
        if record.kind == "review":
            payload["review_seconds"] += seconds
        elif record.kind == "practice":
            payload["practice_seconds"] += seconds
        elif record.kind == "palace_edit":
            payload["palace_edit_seconds"] += seconds
        if not payload["palace_title"] and record.title:
            payload["palace_title"] = record.title

    return sorted(
        grouped.values(),
        key=lambda item: (-int(item["total_seconds"]), str(item["palace_title"]), int(item["palace_id"])),
    )


def get_time_record_duration_seconds(
    session: Session,
    *,
    kinds: tuple[str, ...],
    start: datetime,
    end: datetime,
) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(kinds),
            TimeRecord.effective_seconds > threshold,
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


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


def _current_week_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    start = datetime.combine(start_of_week, time.min)
    end = datetime.combine(today + timedelta(days=1), time.min)
    return start, end


def _current_month_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start_of_month = today.replace(day=1)
    start = datetime.combine(start_of_month, time.min)
    end = _start_of_next_month(start_of_month)
    return start, end


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    start = datetime.combine(start_of_month, time.min)
    end = _start_of_next_month(start_of_month)
    return start, end


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(start_date, time.min)
    end = datetime.combine(end_date + timedelta(days=1), time.min)
    return start, end


def _start_of_next_month(start_of_month: date) -> datetime:
    if start_of_month.month == 12:
        next_month = date(start_of_month.year + 1, 1, 1)
    else:
        next_month = date(start_of_month.year, start_of_month.month + 1, 1)
    return datetime.combine(next_month, time.min)


def _parse_events(raw: str | None) -> list[dict[str, Any]]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _find_event_time(
    events: list[dict[str, Any]],
    preferred_types: set[str],
    *,
    fallback: str = "first",
) -> datetime | None:
    for event in events:
        if str(event.get("type") or "") not in preferred_types:
            continue
        parsed = _parse_event_datetime(event.get("at"))
        if parsed is not None:
            return parsed
    ordered = events if fallback == "first" else list(reversed(events))
    for event in ordered:
        parsed = _parse_event_datetime(event.get("at"))
        if parsed is not None:
            return parsed
    return None


def _parse_event_datetime(raw: Any) -> datetime | None:
    if raw in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def _normalize_stored_event_datetime(
    stored: datetime | None,
    event_at: datetime | None,
) -> datetime | None:
    if stored is None or event_at is None:
        return None
    utc_naive = event_at.astimezone(UTC).replace(tzinfo=None)
    if abs((stored - utc_naive).total_seconds()) > 2:
        return stored
    local_naive = event_at.astimezone().replace(tzinfo=None)
    return local_naive


def _repair_shifted_record_bounds(
    record: TimeRecord,
    started_at: datetime,
    ended_at: datetime,
    *,
    start_event: datetime | None,
    end_event: datetime | None,
) -> tuple[datetime, datetime]:
    expected_start = start_event.astimezone().replace(tzinfo=None) if start_event is not None else None
    expected_end = end_event.astimezone().replace(tzinfo=None) if end_event is not None else None

    if expected_start is not None and _is_whole_day_shift(started_at, expected_start):
        started_at = expected_start
    if expected_end is not None and _is_whole_day_shift(ended_at, expected_end):
        ended_at = expected_end

    if expected_start is not None and expected_end is not None:
        if _needs_duration_repair(started_at, ended_at, record.effective_seconds) and _matches_expected_elapsed(expected_start, expected_end, record.effective_seconds):
            return expected_start, expected_end

    if (
        expected_start is None
        and expected_end is None
        and not record.duration_edited
        and record.pause_count == 0
        and _needs_duration_repair(started_at, ended_at, record.effective_seconds)
    ):
        corrected_end = started_at + timedelta(seconds=max(0, int(record.effective_seconds)))
        return started_at, corrected_end

    return started_at, ended_at


def _is_whole_day_shift(stored: datetime, expected: datetime, tolerance_seconds: int = 120) -> bool:
    delta_seconds = abs((stored - expected).total_seconds())
    if delta_seconds <= tolerance_seconds:
        return False
    whole_days = round(delta_seconds / 86400)
    if whole_days <= 0:
        return False
    return abs(delta_seconds - (whole_days * 86400)) <= tolerance_seconds


def _needs_duration_repair(started_at: datetime, ended_at: datetime, effective_seconds: int, tolerance_seconds: int = 120) -> bool:
    actual_seconds = abs((ended_at - started_at).total_seconds())
    delta_seconds = abs(actual_seconds - max(0, int(effective_seconds)))
    if delta_seconds <= tolerance_seconds:
        return False
    whole_days = round(delta_seconds / 86400)
    if whole_days <= 0:
        return False
    return abs(delta_seconds - (whole_days * 86400)) <= tolerance_seconds


def _matches_expected_elapsed(started_at: datetime, ended_at: datetime, effective_seconds: int, tolerance_seconds: int = 120) -> bool:
    actual_seconds = abs((ended_at - started_at).total_seconds())
    return abs(actual_seconds - max(0, int(effective_seconds))) <= tolerance_seconds


def _ensure_review_log_time_record(session: Session, log: ReviewLog) -> dict | None:
    record_id = f"review-log-{log.id}"
    existing = session.query(TimeRecord).filter_by(id=record_id).first()
    if existing is not None:
        return None

    review_day = log.review_date or date.today()
    ended_at = datetime.combine(review_day, time(hour=12))
    title = log.palace.title if log.palace else "未命名宫殿"
    return create_review_time_record(
        session,
        record_id=record_id,
        palace_id=log.palace_id,
        palace_segment_id=None,
        title=title,
        duration_seconds=log.duration_seconds,
        ended_at=ended_at,
        completion_method="manual_complete",
    )


def _review_log_group_key(log: ReviewLog) -> tuple[int | None, date, int]:
    return (log.palace_id, log.review_date or date.today(), max(0, int(log.duration_seconds)))


def _review_record_group_key(record: TimeRecord) -> tuple[int | None, date, int]:
    return (record.palace_id, record.started_at.date(), max(0, int(record.effective_seconds)))


def _review_record_sort_key(record: TimeRecord) -> tuple[int, datetime]:
    return (1 if record.id.startswith("review-log-") else 0, record.started_at)
