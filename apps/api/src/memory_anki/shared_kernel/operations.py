from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class OperationStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class OperationIdentity:
    operation_id: str
    owner_type: str
    owner_id: str
    owner_revision: int

    def matches(self, other: OperationIdentity) -> bool:
        return self == other


@dataclass(frozen=True, slots=True)
class OperationRun:
    run_id: str
    kind: str
    identity: OperationIdentity
    status: OperationStatus
    input_snapshot: Mapping[str, Any]
    progress: float = 0.0
    result_reference: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None

    def accepts(self, identity: OperationIdentity) -> bool:
        return self.identity.matches(identity) and self.status in {
            OperationStatus.PENDING,
            OperationStatus.RUNNING,
        }
