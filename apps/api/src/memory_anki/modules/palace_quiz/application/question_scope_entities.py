from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    PalaceMiniPalace,
    PalaceQuizQuestion,
)

from .question_contracts import PalaceQuizNotFoundError, PalaceQuizValidationError


def get_chapter_or_raise(session: Session, chapter_id: int) -> Chapter:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    if not chapter:
        raise PalaceQuizNotFoundError("章节不存在。")
    return chapter


def get_mini_palace_or_raise(
    session: Session,
    palace_id: int,
    mini_palace_id: int,
) -> PalaceMiniPalace:
    mini_palace = (
        session.query(PalaceMiniPalace)
        .filter_by(id=mini_palace_id, palace_id=palace_id)
        .first()
    )
    if not mini_palace:
        raise PalaceQuizValidationError("专项训练不存在，或不属于当前宫殿。")
    return mini_palace


def get_origin_question_or_raise(
    session: Session,
    *,
    palace_id: int,
    origin_question_id: int,
) -> PalaceQuizQuestion:
    origin_question = (
        session.query(PalaceQuizQuestion)
        .filter_by(id=origin_question_id, palace_id=palace_id)
        .first()
    )
    if not origin_question:
        raise PalaceQuizValidationError("原始题目不存在，无法建立专项训练归类副本。")
    return origin_question


__all__ = [
    "get_chapter_or_raise",
    "get_mini_palace_or_raise",
    "get_origin_question_or_raise",
]
