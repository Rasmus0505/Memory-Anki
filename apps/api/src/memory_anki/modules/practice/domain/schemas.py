from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FreestyleQuestionBase(BaseModel):
    model_config = ConfigDict(extra="allow")

    question_id: int | None = None
    palace_id: int | None = None
    palace_title: str | None = None
    mini_palace_id: int | None = None
    mini_palace_name: str | None = None
    chapter_id: int | None = None
    chapter_name: str | None = None
    question_type: str | None = None
    stem_snapshot: str | None = None


class FreestyleQuestionAttemptCreate(FreestyleQuestionBase):
    mode: str | None = None
    answer_payload: Any = None
    is_correct: bool | None = None


class FreestyleQuestionExplanationCreate(FreestyleQuestionBase):
    user_question: str | None = None
    explanation_text: str | None = None
    ai_call_log_id: str | None = None


class FreestyleQueueBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str
    round_id: str = ""
    config: dict[str, Any] | None = None
    completed_ids: list[str] = Field(default_factory=list)
    hidden_ids: list[str] = Field(default_factory=list)


class FreestyleRoundActiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str
    scope_key: str
    config: dict[str, Any] = Field(default_factory=dict)
    cards: list[dict[str, Any]] = Field(default_factory=list)
    round_id: str = ""


class FreestyleRoundStartRequest(FreestyleRoundActiveRequest):
    pass


class FreestyleRoundActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str
    expected_version: int
    action: str
    card_id: str = ""
    occurrence_id: str = ""
    encounter_id: str = ""
    cards: list[dict[str, Any]] = Field(default_factory=list)


class FreestyleRoundRatingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: str
    expected_version: int
    card_id: str
    occurrence_id: str = ""
    encounter_id: str
    rating: int
    study_session_id: str
    unit_id: str
    unit_revision: int
    palace_batch: dict[str, Any] | None = None
