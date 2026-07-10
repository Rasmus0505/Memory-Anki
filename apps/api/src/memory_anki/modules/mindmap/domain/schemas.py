from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RecallRating = Literal[1, 3, 5]
RecallRound = Literal["first", "weak_retry"]


class RecallEventCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    study_session_id: str = Field(min_length=1, max_length=64)
    palace_id: int
    node_uid: str = Field(min_length=1, max_length=128)
    source_scene: str = "formal_review"
    recall_round: RecallRound = "first"
    rating: RecallRating
    occurred_at: datetime | None = None
    supersedes_event_id: str | None = None


class NodeLabelUpdate(BaseModel):
    label: Literal["weak", "mastered"] | None = None
