from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion


def query_palace_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter_by(palace_id=palace_id)


def query_root_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter_by(
        palace_id=palace_id,
        mini_palace_id=None,
    )


def query_chapter_question_rows(
    session: Session,
    *,
    chapter_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter_by(source_chapter_id=chapter_id)


def query_aggregated_chapter_question_rows(
    session: Session,
    *,
    chapter_ids: list[int],
) -> Query | None:
    if not chapter_ids:
        return None
    return session.query(PalaceQuizQuestion).filter(
        or_(
            PalaceQuizQuestion.source_chapter_id.in_(chapter_ids),
            PalaceQuizQuestion.classified_chapter_id.in_(chapter_ids),
        )
    )


__all__ = [
    "query_aggregated_chapter_question_rows",
    "query_chapter_question_rows",
    "query_palace_question_rows",
    "query_root_question_rows",
]
