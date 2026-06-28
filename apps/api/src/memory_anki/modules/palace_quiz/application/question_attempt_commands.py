from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import (
    QUESTION_TYPE_MULTIPLE_CHOICE,
    PalaceQuizValidationError,
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


def _normalize_attempt_reset_ids(question_ids: list[int]) -> list[int]:
    if not isinstance(question_ids, list) or len(question_ids) == 0:
        raise PalaceQuizValidationError("清空做题进度时至少需要选择一题。")
    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_id in question_ids:
        try:
            question_id = int(raw_id)
        except (TypeError, ValueError) as exc:
            raise PalaceQuizValidationError("清空做题进度的题目 id 不合法。") from exc
        if question_id <= 0 or question_id in seen_ids:
            continue
        seen_ids.add(question_id)
        normalized_ids.append(question_id)
    if len(normalized_ids) == 0:
        raise PalaceQuizValidationError("清空做题进度时至少需要选择一题。")
    return normalized_ids


def reset_question_attempts(session: Session, question_ids: list[int]) -> int:
    normalized_ids = _normalize_attempt_reset_ids(question_ids)
    rows = (
        session.query(PalaceQuizQuestion)
        .filter(PalaceQuizQuestion.id.in_(normalized_ids))
        .all()
    )
    now = utc_now_naive()
    for row in rows:
        row.attempt_count = 0
        row.correct_count = 0
        row.incorrect_count = 0
        row.updated_at = now
    session.commit()
    return len(rows)


__all__ = ["record_choice_attempt", "reset_question_attempts"]
