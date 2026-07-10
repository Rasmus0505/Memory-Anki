from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from memory_anki.infrastructure.db._tables.misc import StudySession


def _json_dumps(value: Any, fallback: str) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def _json_loads[T](raw: str | None, fallback: T) -> T:
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
