"""Domain events emitted by memory."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class NodesRated:
    palace_id: int
    node_uids: tuple[str, ...]
    rated_at: datetime
    session_id: str | None = None


@dataclass(frozen=True, slots=True)
class WaveCompleted:
    palace_id: int
    wave_id: str
    completed_at: datetime


@dataclass(frozen=True, slots=True)
class WavePaused:
    palace_id: int
    wave_id: str
    paused_at: datetime


__all__ = ["NodesRated", "WaveCompleted", "WavePaused"]
