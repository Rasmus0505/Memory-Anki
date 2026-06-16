from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_row_ordering import (
    apply_chapter_dedup_order,
    apply_palace_dedup_order,
    apply_question_display_order,
)
from .question_row_scope_queries import (
    query_aggregated_chapter_question_rows,
    query_chapter_question_rows,
    query_palace_question_rows,
    query_root_question_rows,
)


def list_palace_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> list[PalaceQuizQuestion]:
    return apply_question_display_order(
        query_palace_question_rows(session, palace_id=palace_id)
    ).all()


def list_palace_dedup_rows(
    session: Session,
    *,
    palace_id: int,
) -> list[PalaceQuizQuestion]:
    return apply_palace_dedup_order(
        query_palace_question_rows(session, palace_id=palace_id)
    ).all()


def list_root_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> list[PalaceQuizQuestion]:
    return apply_question_display_order(
        query_root_question_rows(session, palace_id=palace_id)
    ).all()


def list_chapter_question_rows(
    session: Session,
    *,
    chapter_id: int,
) -> list[PalaceQuizQuestion]:
    return apply_question_display_order(
        query_chapter_question_rows(session, chapter_id=chapter_id)
    ).all()


def list_chapter_dedup_rows(
    session: Session,
    *,
    chapter_id: int,
) -> list[PalaceQuizQuestion]:
    return apply_chapter_dedup_order(
        query_chapter_question_rows(session, chapter_id=chapter_id)
    ).all()


def list_aggregated_chapter_question_rows(
    session: Session,
    *,
    chapter_ids: list[int],
) -> list[PalaceQuizQuestion]:
    query = query_aggregated_chapter_question_rows(session, chapter_ids=chapter_ids)
    if query is None:
        return []
    return apply_question_display_order(query).all()


__all__ = [
    "list_aggregated_chapter_question_rows",
    "list_chapter_dedup_rows",
    "list_chapter_question_rows",
    "list_palace_dedup_rows",
    "list_palace_question_rows",
    "list_root_question_rows",
]
