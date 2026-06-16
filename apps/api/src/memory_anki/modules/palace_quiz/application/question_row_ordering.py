from __future__ import annotations

from sqlalchemy.orm import Query

from memory_anki.infrastructure.db.models import PalaceQuizQuestion


def apply_question_display_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


def apply_palace_dedup_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.mini_palace_id.asc(),
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


def apply_chapter_dedup_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.classified_chapter_id.asc(),
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


__all__ = [
    "apply_chapter_dedup_order",
    "apply_palace_dedup_order",
    "apply_question_display_order",
]
