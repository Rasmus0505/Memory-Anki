"""Published-question and mastery projections for freestyle queue building."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session, selectinload

from memory_anki.infrastructure.db._tables.palaces import (
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.palace_quiz.application.learning_loop import build_mastery_profile
from memory_anki.modules.palace_quiz.application.question_schema import serialize_question


def list_published_questions_for_palaces(
    session: Session,
    *,
    palace_ids: list[int] | None = None,
    question_type: str = "all",
) -> list[dict[str, Any]]:
    query = (
        session.query(PalaceQuizQuestion)
        .options(
            selectinload(PalaceQuizQuestion.mini_palace),
            selectinload(PalaceQuizQuestion.segments),
            selectinload(PalaceQuizQuestion.source_chapter),
            selectinload(PalaceQuizQuestion.classified_chapter),
        )
        .filter(
            PalaceQuizQuestion.deleted_at.is_(None),
            PalaceQuizQuestion.lifecycle_status == "published",
        )
        .order_by(PalaceQuizQuestion.palace_id.asc(), PalaceQuizQuestion.id.asc())
    )
    if palace_ids is not None:
        if not palace_ids:
            return []
        query = query.filter(PalaceQuizQuestion.palace_id.in_(palace_ids))
    if question_type and question_type != "all":
        query = query.filter(PalaceQuizQuestion.question_type == question_type)
    return [serialize_question(row) for row in query.all()]


def list_node_bindings_for_palaces(
    session: Session,
    *,
    palace_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    query = session.query(PalaceQuizQuestionNodeBinding).order_by(
        PalaceQuizQuestionNodeBinding.palace_id.asc(),
        PalaceQuizQuestionNodeBinding.question_id.asc(),
        PalaceQuizQuestionNodeBinding.node_uid.asc(),
    )
    if palace_ids is not None:
        if not palace_ids:
            return []
        query = query.filter(PalaceQuizQuestionNodeBinding.palace_id.in_(palace_ids))
    return [
        {
            "palace_id": int(row.palace_id),
            "question_id": int(row.question_id),
            "node_uid": str(row.node_uid),
        }
        for row in query.all()
        if row.palace_id and row.question_id and row.node_uid
    ]


def list_mastery_profiles_for_palaces(
    session: Session,
    *,
    palace_ids: list[int] | None = None,
    limit_per_palace: int = 500,
) -> list[dict[str, Any]]:
    if palace_ids is not None and not palace_ids:
        return []
    if palace_ids is None:
        return build_mastery_profile(session, palace_id=None, limit=limit_per_palace)
    result: list[dict[str, Any]] = []
    for palace_id in palace_ids:
        result.extend(
            build_mastery_profile(session, palace_id=palace_id, limit=limit_per_palace)
        )
    return result


__all__ = [
    "list_mastery_profiles_for_palaces",
    "list_node_bindings_for_palaces",
    "list_published_questions_for_palaces",
]
