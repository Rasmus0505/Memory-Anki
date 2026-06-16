from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .question_dedup_queries import (
    dedupe_chapter_questions,
    dedupe_palace_questions,
)
from .question_lookup_queries import (
    get_palace_or_raise,
    resolve_minimal_explicit_chapter_ids,
)
from .question_row_queries import (
    list_aggregated_chapter_question_rows,
    list_chapter_question_rows,
    list_palace_question_rows,
    list_root_question_rows,
)
from .question_schema import (
    get_chapter_or_raise,
    serialize_question_rows,
)


def list_questions(session: Session, palace_id: int) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    dedupe_palace_questions(session, palace_id)
    return serialize_question_rows(list_palace_question_rows(session, palace_id=palace_id))


def list_aggregated_questions(session: Session, palace_id: int) -> list[dict[str, Any]]:
    palace = get_palace_or_raise(session, palace_id)
    dedupe_palace_questions(session, palace_id)
    minimal_chapter_ids = resolve_minimal_explicit_chapter_ids(session, palace)
    for chapter_id in minimal_chapter_ids:
        dedupe_chapter_questions(session, chapter_id)
    palace_rows = list_palace_question_rows(session, palace_id=palace_id)
    chapter_rows = list_aggregated_chapter_question_rows(session, chapter_ids=minimal_chapter_ids)
    return serialize_question_rows([*palace_rows, *chapter_rows])


def list_root_questions(session: Session, palace_id: int):
    get_palace_or_raise(session, palace_id)
    return serialize_question_rows(list_root_question_rows(session, palace_id=palace_id))


def list_chapter_questions(session: Session, chapter_id: int) -> list[dict[str, Any]]:
    get_chapter_or_raise(session, chapter_id)
    dedupe_chapter_questions(session, chapter_id)
    return serialize_question_rows(list_chapter_question_rows(session, chapter_id=chapter_id))


__all__ = [
    "list_aggregated_questions",
    "list_chapter_questions",
    "list_questions",
    "list_root_questions",
]
