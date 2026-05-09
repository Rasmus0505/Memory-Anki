from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import iso_utc_now
from memory_anki.infrastructure.db.models import Config, ReviewLog, TimeRecord

TIME_RECORD_DASHBOARD_KINDS = ("review", "practice", "palace_edit")


def _normalize_record(record: TimeRecord) -> dict:
    return {
        "id": record.id,
        "kind": record.kind,
        "palaceId": record.palace_id,
        "title": record.title,
        "startedAt": record.started_at.isoformat(),
        "endedAt": record.ended_at.isoformat(),
        "effectiveSeconds": record.effective_seconds,
        "pauseCount": record.pause_count,
        "completionMethod": record.completion_method,
        "durationEdited": bool(record.duration_edited),
        "deletedAt": record.deleted_at.isoformat() if record.deleted_at else None,
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
    record = TimeRecord(
        id=str(payload["id"]),
        kind=str(payload["kind"]),
        palace_id=payload.get("palaceId"),
        title=str(payload.get("title", "")),
        started_at=_parse_datetime(payload["startedAt"]),
        ended_at=_parse_datetime(payload["endedAt"]),
        effective_seconds=effective_seconds,
        pause_count=max(0, int(payload.get("pauseCount", 0))),
        completion_method=str(payload.get("completionMethod", "manual_complete")),
        duration_edited=bool(payload.get("durationEdited", False)),
        deleted_reason=payload.get("deletedReason"),
        deleted_at=_parse_optional_datetime(payload.get("deletedAt")),
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
        "title": ("title", str),
        "startedAt": ("started_at", _parse_datetime),
        "endedAt": ("ended_at", _parse_datetime),
        "effectiveSeconds": ("effective_seconds", lambda value: max(0, int(value))),
        "pauseCount": ("pause_count", lambda value: max(0, int(value))),
        "completionMethod": ("completion_method", str),
        "durationEdited": ("duration_edited", bool),
        "deletedReason": ("deleted_reason", lambda value: value),
        "deletedAt": ("deleted_at", _parse_optional_datetime),
        "events": ("events_json", lambda value: json.dumps(value, ensure_ascii=False)),
    }
    for key, (field, transform) in mapping.items():
        if key in updater:
            setattr(record, field, transform(updater[key]))

    session.commit()
    session.refresh(record)
    return _normalize_record(record)


def soft_delete_time_record(session: Session, record_id: str) -> dict | None:
    return update_time_record(
        session,
        record_id,
        {"deletedAt": iso_utc_now(), "deletedReason": "manual"},
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


def create_review_time_record(
    session: Session,
    *,
    record_id: str,
    palace_id: int | None,
    title: str,
    duration_seconds: int,
    ended_at: datetime,
    completion_method: str = "manual_complete",
) -> dict | None:
    safe_duration = max(0, int(duration_seconds))
    if safe_duration <= 0:
        return None
    started_at = ended_at - timedelta(seconds=safe_duration)
    record = TimeRecord(
        id=record_id,
        kind="review",
        palace_id=palace_id,
        title=title,
        started_at=started_at,
        ended_at=ended_at,
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


def get_weekly_total_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_weekly_formal_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("review",),
        start=start,
        end=end,
    )


def get_time_record_duration_seconds(
    session: Session,
    *,
    kinds: tuple[str, ...],
    start: datetime,
    end: datetime,
) -> int:
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(kinds),
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def _parse_datetime(raw: str) -> datetime:
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))


def _parse_optional_datetime(raw: str | None) -> datetime | None:
    if raw in (None, ""):
        return None
    return _parse_datetime(str(raw))


def _current_week_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    start = datetime.combine(start_of_week, time.min)
    end = datetime.combine(today + timedelta(days=1), time.min)
    return start, end


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
