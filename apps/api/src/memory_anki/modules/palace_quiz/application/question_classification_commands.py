from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_queries import next_palace_sort_order
from .question_schema import validate_mini_palace
from .question_write_support import upsert_classified_question_copy_row


def upsert_classified_question_copy(
    session: Session,
    *,
    source_question: PalaceQuizQuestion,
    mini_palace_id: int,
) -> PalaceQuizQuestion:
    validate_mini_palace(session, source_question.palace_id, mini_palace_id)
    existing = (
        session.query(PalaceQuizQuestion)
        .filter_by(
            palace_id=source_question.palace_id,
            mini_palace_id=mini_palace_id,
            origin_question_id=source_question.id,
        )
        .first()
    )
    if existing:
        row = existing
    else:
        row = PalaceQuizQuestion(
            palace_id=source_question.palace_id,
            mini_palace_id=mini_palace_id,
            origin_question_id=source_question.id,
            sort_order=next_palace_sort_order(session, source_question.palace_id) + 1,
        )
        session.add(row)
    return upsert_classified_question_copy_row(
        session,
        row=row,
        source_question=source_question,
    )


__all__ = ["upsert_classified_question_copy"]
