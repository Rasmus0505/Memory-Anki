from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion


def next_palace_sort_order(session: Session, palace_id: int) -> int:
    current = (
        session.query(PalaceQuizQuestion.sort_order)
        .filter(PalaceQuizQuestion.palace_id == palace_id)
        .order_by(PalaceQuizQuestion.sort_order.desc())
        .limit(1)
        .scalar()
    )
    return int(current or 0)


def next_chapter_sort_order(session: Session, chapter_id: int) -> int:
    current = (
        session.query(PalaceQuizQuestion.sort_order)
        .filter(PalaceQuizQuestion.source_chapter_id == chapter_id)
        .order_by(PalaceQuizQuestion.sort_order.desc())
        .limit(1)
        .scalar()
    )
    return int(current or 0)


__all__ = [
    "next_chapter_sort_order",
    "next_palace_sort_order",
]
