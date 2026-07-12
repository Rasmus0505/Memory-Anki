from __future__ import annotations

from dataclasses import dataclass

from memory_anki.modules.learning_record.domain.learning_event import LearningEvent


@dataclass(frozen=True, slots=True)
class AppendLearningEvent:
    event: LearningEvent


@dataclass(frozen=True, slots=True)
class LearningEventAppended:
    event_id: str
