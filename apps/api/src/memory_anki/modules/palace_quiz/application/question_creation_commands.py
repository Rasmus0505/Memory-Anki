from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_batch_creation_support import (
    batch_create_questions_for_scope,
)
from .question_contracts import PalaceQuizValidationError
from .question_queries import (
    get_palace_or_raise,
    next_chapter_sort_order,
    next_palace_sort_order,
)
from .question_schema import (
    find_duplicate_question,
    get_chapter_or_raise,
    normalize_question_payload,
)
from .question_serialization import serialize_question
from .question_write_support import (
    build_normalized_question_row,
    commit_new_question,
)


def create_question(
    session: Session,
    palace_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    get_palace_or_raise(session, palace_id)
    normalized = normalize_question_payload(payload, session=session, palace_id=palace_id)
    duplicate = find_duplicate_question(session, palace_id, None, normalized)
    if duplicate is not None:
        return serialize_question(duplicate)
    row = build_normalized_question_row(
        normalized=normalized,
        palace_id=palace_id,
        source_chapter_id=None,
        sort_order=next_palace_sort_order(session, palace_id) + 1,
    )
    return commit_new_question(session, row)


def batch_create_questions(
    session: Session,
    palace_id: int,
    payloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    existing_questions = session.query(PalaceQuizQuestion).filter_by(palace_id=palace_id).all()
    return batch_create_questions_for_scope(
        session,
        payloads=payloads,
        existing_questions=existing_questions,
        next_sort_order=next_palace_sort_order(session, palace_id),
        normalize_payload=lambda payload: normalize_question_payload(
            payload,
            session=session,
            palace_id=palace_id,
        ),
        create_row=lambda normalized, sort_order: build_normalized_question_row(
            normalized=normalized,
            palace_id=palace_id,
            source_chapter_id=None,
            sort_order=sort_order,
        ),
    )


def batch_create_chapter_questions(
    session: Session,
    chapter_id: int,
    payloads: list[dict[str, Any]],
    *,
    save_mode: str = "append",
) -> list[dict[str, Any]]:
    get_chapter_or_raise(session, chapter_id)
    normalized_save_mode = str(save_mode or "append").strip().lower()
    if normalized_save_mode not in {"append", "overwrite"}:
        raise PalaceQuizValidationError("题目保存模式必须是 append 或 overwrite。")
    existing_questions = (
        session.query(PalaceQuizQuestion).filter_by(source_chapter_id=chapter_id).all()
    )
    excluded_import_question_ids: set[int] | None = None
    next_sort_order = next_chapter_sort_order(session, chapter_id)
    if normalized_save_mode == "overwrite":
        excluded_import_question_ids = {int(question.id) for question in existing_questions}
        for question in existing_questions:
            session.delete(question)
        existing_questions = []
        next_sort_order = 0
    return batch_create_questions_for_scope(
        session,
        payloads=payloads,
        existing_questions=existing_questions,
        excluded_import_question_ids=excluded_import_question_ids,
        next_sort_order=next_sort_order,
        normalize_payload=lambda payload: normalize_question_payload(
            {
                **payload,
                "source_chapter_id": chapter_id,
            },
            session=session,
            source_chapter_id=chapter_id,
        ),
        create_row=lambda normalized, sort_order: build_normalized_question_row(
            normalized=normalized,
            palace_id=None,
            source_chapter_id=chapter_id,
            sort_order=sort_order,
        ),
    )


__all__ = [
    "batch_create_chapter_questions",
    "batch_create_questions",
    "create_question",
]
