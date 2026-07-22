from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    chapter_palace_table,
)
from memory_anki.modules.quiz.public.queries import serialize_question

from .card_context import chapter_context, palace_context, segment_context

CONTENT_TYPE_QUIZ_QUESTION = "quiz_question"

# Soft cap so freestyle feed never serializes an unbounded question bank in one response.
DEFAULT_QUIZ_CARD_LIMIT = 400


def _question_sort_key(question: PalaceQuizQuestion) -> tuple[int, int, int]:
    return (
        int(getattr(question, "mini_palace_id", 0) or 0),
        int(getattr(question, "sort_order", 0) or 0),
        int(getattr(question, "id", 0) or 0),
    )


def _load_explicit_chapter_ids_by_palace(
    session: Session,
    palace_ids: set[int],
) -> dict[int, set[int]]:
    if not palace_ids:
        return {}
    rows = (
        session.query(chapter_palace_table.c.palace_id, chapter_palace_table.c.chapter_id)
        .filter(
            chapter_palace_table.c.palace_id.in_(palace_ids),
            chapter_palace_table.c.is_explicit == True,
        )
        .all()
    )
    result: dict[int, set[int]] = defaultdict(set)
    for palace_id, chapter_id in rows:
        if palace_id is not None and chapter_id is not None:
            result[int(palace_id)].add(int(chapter_id))
    return result


def _chapter_ids_by_palace(session: Session, palaces: list[Palace]) -> dict[int, set[int]]:
    explicit_by_palace = _load_explicit_chapter_ids_by_palace(
        session,
        {palace.id for palace in palaces},
    )
    return {
        palace.id: explicit_by_palace.get(palace.id)
        or {chapter.id for chapter in palace.chapters or []}
        for palace in palaces
    }


def _load_chapter_questions_by_palace(
    session: Session,
    palaces: list[Palace],
) -> dict[int, list[PalaceQuizQuestion]]:
    chapter_ids_by_palace = _chapter_ids_by_palace(session, palaces)
    palace_ids_by_chapter: dict[int, set[int]] = defaultdict(set)
    for palace_id, chapter_ids in chapter_ids_by_palace.items():
        for chapter_id in chapter_ids:
            palace_ids_by_chapter[chapter_id].add(palace_id)
    all_chapter_ids = set(palace_ids_by_chapter)
    if not all_chapter_ids:
        return {}

    questions = (
        session.query(PalaceQuizQuestion)
        .options(
            selectinload(PalaceQuizQuestion.mini_palace),
            selectinload(PalaceQuizQuestion.source_chapter).selectinload(Chapter.subject),
            selectinload(PalaceQuizQuestion.classified_chapter).selectinload(Chapter.subject),
        )
        .outerjoin(Palace, Palace.id == PalaceQuizQuestion.palace_id)
        .filter(
            PalaceQuizQuestion.source_chapter_id.in_(all_chapter_ids),
            PalaceQuizQuestion.deleted_at.is_(None),
            PalaceQuizQuestion.lifecycle_status == "published",
            or_(
                PalaceQuizQuestion.palace_id.is_(None),
                Palace.deleted_at.is_(None),
            ),
        )
        .order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc())
        .all()
    )

    result: dict[int, list[PalaceQuizQuestion]] = defaultdict(list)
    for question in questions:
        chapter_id = int(question.source_chapter_id or 0)
        for palace_id in palace_ids_by_chapter.get(chapter_id, set()):
            result[palace_id].append(question)
    return result


def _iter_palace_questions(
    palace: Palace,
    chapter_questions: list[PalaceQuizQuestion],
) -> list[PalaceQuizQuestion]:
    seen: set[int] = set()
    rows: list[PalaceQuizQuestion] = []
    for question in sorted(palace.quiz_questions or [], key=_question_sort_key):
        if getattr(question, "deleted_at", None) is not None:
            continue
        if question.id in seen:
            continue
        seen.add(question.id)
        rows.append(question)

    for question in sorted(chapter_questions, key=_question_sort_key):
        if question.id in seen:
            continue
        seen.add(question.id)
        rows.append(question)
    return rows


def build_quiz_cards(
    session: Session,
    palaces: list[Palace],
    *,
    range_filter: str,
    due_ids: set[int],
    practice_ids: set[int],
    due_range: str,
    needs_practice_range: str,
    wrong_range: str = "",
    limit: int = DEFAULT_QUIZ_CARD_LIMIT,
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    chapter_questions_by_palace = _load_chapter_questions_by_palace(session, palaces)
    card_limit = max(0, int(limit))
    for palace in palaces:
        if range_filter == due_range and palace.id not in due_ids:
            continue
        if range_filter == needs_practice_range and palace.id not in practice_ids:
            continue
        context = palace_context(palace)
        for question in _iter_palace_questions(palace, chapter_questions_by_palace.get(palace.id, [])):
            if range_filter == wrong_range and int(question.incorrect_count or 0) <= 0:
                continue
            segments = list(getattr(question, "segments", []) or [])
            source_chapter = (
                question.classified_chapter
                if question.classified_chapter is not None
                else question.source_chapter
            )
            cards.append(
                {
                    "id": f"quiz_question:{palace.id}:{question.id}",
                    "type": "quiz_question",
                    "content_type": CONTENT_TYPE_QUIZ_QUESTION,
                    "question": serialize_question(question),
                    "palace_context": context,
                    "segment_contexts": [segment_context(segment) for segment in segments],
                    "chapter_context": chapter_context(source_chapter),
                    "group_key": f"palace:{palace.id}",
                }
            )
            if len(cards) >= card_limit:
                return cards
    return cards


__all__ = [
    "CONTENT_TYPE_QUIZ_QUESTION",
    "DEFAULT_QUIZ_CARD_LIMIT",
    "build_quiz_cards",
]

