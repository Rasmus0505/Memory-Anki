from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import PalaceQuizValidationError
from .question_queries import get_question_or_raise
from .question_write_support import commit_deleted_questions


def _normalize_batch_delete_ids(question_ids: list[int]) -> list[int]:
    if not isinstance(question_ids, list) or len(question_ids) == 0:
        raise PalaceQuizValidationError("批量删除时至少需要选择一题。")
    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_id in question_ids:
        try:
            question_id = int(raw_id)
        except (TypeError, ValueError) as exc:
            raise PalaceQuizValidationError("批量删除的题目 id 不合法。") from exc
        if question_id <= 0 or question_id in seen_ids:
            continue
        seen_ids.add(question_id)
        normalized_ids.append(question_id)
    if len(normalized_ids) == 0:
        raise PalaceQuizValidationError("批量删除时至少需要选择一题。")
    return normalized_ids


def delete_question(session: Session, question_id: int) -> None:
    question = get_question_or_raise(session, question_id)
    commit_deleted_questions(session, [question])


def batch_delete_questions(session: Session, question_ids: list[int]) -> int:
    normalized_ids = _normalize_batch_delete_ids(question_ids)
    rows = session.query(PalaceQuizQuestion).filter(PalaceQuizQuestion.id.in_(normalized_ids)).all()
    return commit_deleted_questions(session, rows)


__all__ = [
    "batch_delete_questions",
    "delete_question",
]
