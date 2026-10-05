"""Framework-free UTC interval ledger contracts."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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
        return self.model_copy(update={"started_at": start, "ended_at": end})

    @property
    def effective_seconds(self) -> int:
        return max(0, int((_utc(self.ended_at) - _utc(self.started_at)).total_seconds()))


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
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
