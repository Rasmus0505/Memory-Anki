"""Context loading for short-answer feedback generation requests."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import (
    QUESTION_TYPE_SHORT_ANSWER,
    PalaceQuizValidationError,
)
from .question_lookup_queries import get_question_or_raise
from .question_schema import json_load


@dataclass(frozen=True, slots=True)
class ShortAnswerFeedbackRequestContext:
    question: PalaceQuizQuestion
    normalized_user_answer: str
    reference_answer: str


def load_short_answer_feedback_request_context(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
) -> ShortAnswerFeedbackRequestContext:
    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_SHORT_ANSWER:
        raise PalaceQuizValidationError("只有简答题可以生成 AI 点评。")
    normalized_user_answer = str(user_answer or "").strip()
    if not normalized_user_answer:
        raise PalaceQuizValidationError("请先填写你的答案。")
    answer_payload = json_load(question.answer_payload_json, {})
    reference_answer = str(answer_payload.get("reference_answer") or "").strip()
    return ShortAnswerFeedbackRequestContext(
        question=question,
        normalized_user_answer=normalized_user_answer,
        reference_answer=reference_answer,
    )


__all__ = [
    "ShortAnswerFeedbackRequestContext",
    "load_short_answer_feedback_request_context",
]
