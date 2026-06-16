from __future__ import annotations

from sqlalchemy.orm import Session

from .question_contracts import (
    PalaceQuizValidationError,
    QUESTION_TYPE_MULTIPLE_CHOICE,
    json_load,
)
from .question_queries import get_question_or_raise
from .question_write_support import commit_recorded_choice_attempt


def record_choice_attempt(
    session: Session,
    question_id: int,
    selected_option_id: str,
) -> dict[str, object]:
    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_MULTIPLE_CHOICE:
        raise PalaceQuizValidationError("只有选择题可以累计对错统计。")
    normalized_selected_option_id = str(selected_option_id or "").strip()
    if not normalized_selected_option_id:
        raise PalaceQuizValidationError("请选择一个选项。")
    answer_payload = json_load(question.answer_payload_json, {})
    correct_option_id = str(answer_payload.get("correct_option_id") or "").strip()
    is_correct = normalized_selected_option_id == correct_option_id
    question.attempt_count += 1
    if is_correct:
        question.correct_count += 1
    else:
        question.incorrect_count += 1
    return commit_recorded_choice_attempt(
        session,
        row=question,
        selected_option_id=normalized_selected_option_id,
        is_correct=is_correct,
    )


__all__ = ["record_choice_attempt"]
