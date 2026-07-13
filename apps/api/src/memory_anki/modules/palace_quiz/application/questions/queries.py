from __future__ import annotations

from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.palaces.api import get_palace_explicit_chapter_ids

from ..question_contracts import PalaceQuizNotFoundError
from ..question_schema import (
    get_chapter_or_raise,
    serialize_question_rows,
)


def get_palace_or_raise(session: Session, palace_id: int) -> Palace:
    palace = (
        session.query(Palace)
        .filter(Palace.id == palace_id, Palace.deleted_at.is_(None))
        .first()
    )
    if not palace:
        raise PalaceQuizNotFoundError("宫殿不存在。")
    return palace


def get_question_or_raise(session: Session, question_id: int) -> PalaceQuizQuestion:
    question = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id == question_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .first()
    )
    if not question:
        raise PalaceQuizNotFoundError("题目不存在。")
    return question


def next_palace_sort_order(session: Session, palace_id: int) -> int:
    current = (
        session.query(PalaceQuizQuestion.sort_order)
        .filter(
            PalaceQuizQuestion.palace_id == palace_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .order_by(PalaceQuizQuestion.sort_order.desc())
        .limit(1)
        .scalar()
    )
    return int(current or 0)


def next_chapter_sort_order(session: Session, chapter_id: int) -> int:
    current = (
        session.query(PalaceQuizQuestion.sort_order)
        .filter(
            PalaceQuizQuestion.source_chapter_id == chapter_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .order_by(PalaceQuizQuestion.sort_order.desc())
        .limit(1)
        .scalar()
    )
    return int(current or 0)


def resolve_minimal_explicit_chapter_ids(session: Session, palace: Palace) -> list[int]:
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    if not explicit_ids:
        return []
    chapters = session.query(Chapter).filter(Chapter.id.in_(explicit_ids)).all()
    minimal_ids: list[int] = []
    for chapter in chapters:
        has_explicit_descendant = False
        for other in chapters:
            if other.id == chapter.id:
                continue
            current = other.parent
            while current is not None:
                if current.id == chapter.id:
                    has_explicit_descendant = True
                    break
                current = current.parent
            if has_explicit_descendant:
                break
        if not has_explicit_descendant:
            minimal_ids.append(chapter.id)
    return sorted(set(minimal_ids))


def apply_question_display_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


def apply_palace_dedup_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


def apply_chapter_dedup_order(query: Query) -> Query:
    return query.order_by(
        PalaceQuizQuestion.classified_chapter_id.asc(),
        PalaceQuizQuestion.sort_order.asc(),
        PalaceQuizQuestion.id.asc(),
    )


def query_palace_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.palace_id == palace_id,
        PalaceQuizQuestion.deleted_at.is_(None),
    )


def query_root_question_rows(
    session: Session,
    *,
    palace_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.palace_id == palace_id,
        PalaceQuizQuestion.deleted_at.is_(None),
    )


def query_chapter_question_rows(
    session: Session,
    *,
    chapter_id: int,
) -> Query:
    return session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.source_chapter_id == chapter_id,
        PalaceQuizQuestion.deleted_at.is_(None),
    )


def query_aggregated_chapter_question_rows(
    session: Session,
    *,
    chapter_ids: list[int],
) -> Query | None:
    if not chapter_ids:
        return None
    return session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.deleted_at.is_(None),
        or_(
            PalaceQuizQuestion.source_chapter_id.in_(chapter_ids),
            PalaceQuizQuestion.classified_chapter_id.in_(chapter_ids),
        ),
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


def list_questions(session: Session, palace_id: int) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    return serialize_question_rows(list_palace_question_rows(session, palace_id=palace_id))


def list_aggregated_questions(session: Session, palace_id: int) -> list[dict[str, Any]]:
    palace = get_palace_or_raise(session, palace_id)
    minimal_chapter_ids = resolve_minimal_explicit_chapter_ids(session, palace)
    palace_rows = list_palace_question_rows(session, palace_id=palace_id)
    chapter_rows = list_aggregated_chapter_question_rows(session, chapter_ids=minimal_chapter_ids)
    rows = []
    seen_ids: set[int] = set()
    for row in [*palace_rows, *chapter_rows]:
        row_id = int(row.id)
        if row_id in seen_ids:
            continue
        seen_ids.add(row_id)
        rows.append(row)
    return serialize_question_rows(rows)


def list_root_questions(session: Session, palace_id: int):
    get_palace_or_raise(session, palace_id)
    return serialize_question_rows(list_root_question_rows(session, palace_id=palace_id))


def list_chapter_questions(session: Session, chapter_id: int) -> list[dict[str, Any]]:
    get_chapter_or_raise(session, chapter_id)
    return serialize_question_rows(list_chapter_question_rows(session, chapter_id=chapter_id))


__all__ = [
    "apply_chapter_dedup_order",
    "apply_palace_dedup_order",
    "apply_question_display_order",
    "get_palace_or_raise",
    "get_question_or_raise",
    "list_aggregated_chapter_question_rows",
    "list_aggregated_questions",
    "list_chapter_dedup_rows",
    "list_chapter_question_rows",
    "list_chapter_questions",
    "list_palace_dedup_rows",
    "list_palace_question_rows",
    "list_questions",
    "list_root_question_rows",
    "list_root_questions",
    "next_chapter_sort_order",
    "next_palace_sort_order",
    "query_aggregated_chapter_question_rows",
    "query_chapter_question_rows",
    "query_palace_question_rows",
    "query_root_question_rows",
    "resolve_minimal_explicit_chapter_ids",
]
