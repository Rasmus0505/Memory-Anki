from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from memory_anki.core.time import to_api_datetime


def parse_progress_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0)


def serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    normalized = value.replace(second=0, microsecond=0)
    return to_api_datetime(normalized, timespec="minutes")


__all__ = ["parse_progress_datetime", "serialize_stage_datetime"]
