from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RecallRating = Literal[1, 2, 3, 4, 5]
RecallRound = Literal["first", "weak_retry"]
RecallRatingSource = Literal["manual", "inferred"]
RecallRatingScope = Literal["single", "subtree"]
RecallEvidenceOrigin = Literal["direct", "batch_inherited"]


class RecallEventCreate(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    study_session_id: str = Field(min_length=1, max_length=64)
    palace_id: int
    node_uid: str = Field(min_length=1, max_length=128)
    source_scene: str = "formal_review"
    recall_round: RecallRound = "first"
    rating: RecallRating
    rating_source: RecallRatingSource = "manual"
    rating_scope: RecallRatingScope = "single"
    evidence_origin: RecallEvidenceOrigin = "direct"
    inference_confidence: float | None = Field(default=None, ge=0, le=1)
    response_ms: int | None = Field(default=None, ge=0)
    hint_count: int = Field(default=0, ge=0)
    retry_count: int = Field(default=0, ge=0)
    operation_id: str | None = Field(default=None, max_length=64)
    occurred_at: datetime | None = None
    supersedes_event_id: str | None = None


class NodeLabelUpdate(BaseModel):
    label: Literal["weak", "mastered"] | None = None
