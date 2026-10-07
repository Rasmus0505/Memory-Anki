"""Framework-free UTC interval ledger contracts."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .time_record_attribution import StudySessionAttribution


class TimeLedgerInterval(BaseModel):
    """One immutable, device-owned interval submitted by a client."""
    model_config = ConfigDict(extra="forbid")

    interval_id: str = Field(min_length=1, max_length=160)
    session_id: str = Field(min_length=1, max_length=160)
    started_at: datetime
    ended_at: datetime
    kind: str = Field(default="custom", min_length=1, max_length=64)

    @property
    def is_confirmed_interval(self) -> bool:
        return self.ended_at <= datetime.now(UTC)
    title: str = Field(default="", max_length=300)
    client_source: str = Field(default="unknown", max_length=32)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def normalized(self) -> TimeLedgerInterval:
        start = _utc(self.started_at)
        end = _utc(self.ended_at)
        if end < start:
            raise ValueError("ended_at must be greater than or equal to started_at")
        if end > datetime.now(UTC):
            raise ValueError("only confirmed intervals may be uploaded")
        return self.model_copy(
            update={
                "started_at": start,
                "ended_at": end,
                "metadata": self.attribution().as_metadata() | _non_attribution(self.metadata),
            }
        )

    def attribution(self) -> StudySessionAttribution:
        """Four-dimension attribution carried in ``metadata``.

        Reads the flat metadata keys so old revisions (which only had
        ``session_key``) still parse, and new ones keep subject/chapter/unit.
        """
        return StudySessionAttribution.from_metadata(self.metadata)

    @property
    def effective_seconds(self) -> int:
        return max(0, int((_utc(self.ended_at) - _utc(self.started_at)).total_seconds()))


_ATTRIBUTION_KEYS = frozenset(StudySessionAttribution.model_fields)


def _non_attribution(metadata: dict[str, Any]) -> dict[str, Any]:
    """Keep unrelated metadata (session_key, completion_method) untouched."""
    return {key: value for key, value in metadata.items() if key not in _ATTRIBUTION_KEYS}


def _utc(value: datetime) -> datetime:
    """Normalize an interval instant to UTC.

    Naive input is rejected rather than assumed UTC. Guessing here is what let a
    browser that emitted local wall time store an instant shifted by the zone
    offset, which then showed up as study time on the wrong local day.
    """
    if value.tzinfo is None:
        raise ValueError(
            "interval timestamps must include a UTC offset (e.g. 2026-10-06T20:58:15Z)"
        )
    return value.astimezone(UTC)


class TimeLedgerUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intervals: list[TimeLedgerInterval] = Field(min_length=1, max_length=500)


class TimeLedgerSummary(BaseModel):
    total_seconds: int
    interval_count: int
    device_count: int
    by_kind: dict[str, int]


__all__ = ["TimeLedgerInterval", "TimeLedgerUpload", "TimeLedgerSummary"]
