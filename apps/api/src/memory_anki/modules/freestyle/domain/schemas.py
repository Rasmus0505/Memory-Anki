from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


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
