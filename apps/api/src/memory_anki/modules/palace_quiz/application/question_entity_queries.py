from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, PalaceQuizQuestion

from .question_contracts import PalaceQuizNotFoundError


def get_palace_or_raise(session: Session, palace_id: int) -> Palace:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        raise PalaceQuizNotFoundError("宫殿不存在。")
    return palace


def get_question_or_raise(session: Session, question_id: int) -> PalaceQuizQuestion:
    question = session.query(PalaceQuizQuestion).filter_by(id=question_id).first()
    if not question:
        raise PalaceQuizNotFoundError("题目不存在。")
    return question


__all__ = [
    "get_palace_or_raise",
    "get_question_or_raise",
]
