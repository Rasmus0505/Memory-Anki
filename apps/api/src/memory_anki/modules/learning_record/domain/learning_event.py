from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class LearningEvent:
    event_id: str
    session_id: str
    activity_type: str
    subject_reference: str
    stimulus_reference: str | None
    response: Mapping[str, Any]
    outcome: Mapping[str, Any]
    duration_ms: int
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    source_operation_id: str | None = None
    supersedes_event_id: str | None = None

    @property
    def event_name(self) -> str:
        return "learning_record.learning_event_recorded"

    def __post_init__(self) -> None:
        if self.duration_ms < 0:
            raise ValueError("duration_ms must be non-negative")
        if self.supersedes_event_id == self.event_id:
            raise ValueError("a learning event cannot supersede itself")
