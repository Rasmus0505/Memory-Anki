from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4


class DomainEvent(Protocol):
    @property
    def event_name(self) -> str: ...


@dataclass(frozen=True, slots=True)
class EventEnvelope[EventT: DomainEvent]:
    event: EventT
    event_id: str = field(default_factory=lambda: str(uuid4()))
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    correlation_id: str | None = None
    causation_id: str | None = None
