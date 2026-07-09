"""Aggregate wrong-question book from quiz counters and freestyle attempts."""

from __future__ import annotations

from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, selectinload

from memory_anki.infrastructure.db._tables.palaces import (
    FreestyleQuizAttempt,
    Palace,
    PalaceQuizQuestion,
)
from memory_anki.modules.palace_quiz.application.question_schema import serialize_question
from memory_anki.modules.palaces.application.title_sync_service import resolve_palace_title


def get_wrong_questions(session: Session, limit: int = 200) -> dict:
    limit = max(1, min(int(limit), 500))
    attempt_denominator = case(
        (PalaceQuizQuestion.attempt_count > 0, PalaceQuizQuestion.attempt_count),
        else_=1,
    )
    questions = (
        session.query(PalaceQuizQuestion)
        .options(
            selectinload(PalaceQuizQuestion.palace),
            selectinload(PalaceQuizQuestion.mini_palace),
        )
        .outerjoin(Palace, Palace.id == PalaceQuizQuestion.palace_id)
        .filter(
            PalaceQuizQuestion.incorrect_count > 0,
            PalaceQuizQuestion.deleted_at.is_(None),
            or_(
                PalaceQuizQuestion.palace_id.is_(None),
                Palace.deleted_at.is_(None),
            ),
        )
        .order_by(
            (PalaceQuizQuestion.incorrect_count * 1.0 / attempt_denominator).desc(),
            PalaceQuizQuestion.incorrect_count.desc(),
            PalaceQuizQuestion.id.asc(),
        )
        .limit(limit)
        .all()
    )

    question_ids = [question.id for question in questions]
    last_wrong_by_question: dict[int, str] = {}
    if question_ids:
        rows = (
            session.query(
                FreestyleQuizAttempt.question_id,
                func.max(FreestyleQuizAttempt.created_at),
            )
            .filter(
                FreestyleQuizAttempt.question_id.in_(question_ids),
                FreestyleQuizAttempt.is_correct == False,  # noqa: E712
            )
            .group_by(FreestyleQuizAttempt.question_id)
            .all()
        )
        for question_id, created_at in rows:
            if question_id is not None and created_at is not None:
                last_wrong_by_question[int(question_id)] = created_at.isoformat(
                    timespec="minutes"
                )

    items = []
    for question in questions:
        palace: Palace | None = question.palace
        items.append(
            {
                "question": serialize_question(question),
                "palace_id": question.palace_id,
                "palace_title": resolve_palace_title(palace) if palace else "",
                "incorrect_count": question.incorrect_count,
                "correct_count": question.correct_count,
                "attempt_count": question.attempt_count,
                "last_wrong_at": last_wrong_by_question.get(question.id),
            }
        )
    return {"total": len(items), "items": items}
