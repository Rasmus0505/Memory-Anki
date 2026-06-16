from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_record_support import merge_question_attempt_counters
from .question_row_queries import (
    list_chapter_dedup_rows,
    list_palace_dedup_rows,
)
from .question_schema import (
    build_question_dedup_key,
    question_to_dedup_payload,
)


def _dedupe_questions(
    session: Session,
    *,
    rows: list[PalaceQuizQuestion],
) -> int:
    kept_by_key: dict[str, PalaceQuizQuestion] = {}
    removed_count = 0
    for row in rows:
        dedup_key = build_question_dedup_key(question_to_dedup_payload(row))
        existing = kept_by_key.get(dedup_key)
        if existing is None:
            kept_by_key[dedup_key] = row
            continue
        merge_question_attempt_counters(existing, row)
        session.delete(row)
        removed_count += 1
    if removed_count:
        session.commit()
    return removed_count


def dedupe_palace_questions(session: Session, palace_id: int) -> int:
    return _dedupe_questions(
        session,
        rows=list_palace_dedup_rows(session, palace_id=palace_id),
    )


def dedupe_chapter_questions(session: Session, chapter_id: int) -> int:
    return _dedupe_questions(
        session,
        rows=list_chapter_dedup_rows(session, chapter_id=chapter_id),
    )


__all__ = [
    "dedupe_chapter_questions",
    "dedupe_palace_questions",
]
