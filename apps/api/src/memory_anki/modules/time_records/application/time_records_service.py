from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import iso_utc_now
from memory_anki.infrastructure.db.models import Config, TimeRecord


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
    session.merge(record)
    session.commit()
    session.refresh(record)
    return _normalize_record(record)


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
        created = create_time_record(session, item)
        if created is not None:
            imported += 1
    return imported


def _parse_datetime(raw: str) -> datetime:
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))


def _parse_optional_datetime(raw: str | None) -> datetime | None:
    if raw in (None, ""):
        return None
    return _parse_datetime(str(raw))
