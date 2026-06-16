"""Row construction and row-copy helpers for palace quiz question writes."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_record_support import (
    apply_normalized_question_to_row,
    copy_question_content,
)


def build_normalized_question_row(
    *,
    normalized: dict[str, Any],
    palace_id: int | None,
    source_chapter_id: int | None,
    sort_order: int,
) -> PalaceQuizQuestion:
    return apply_normalized_question_to_row(
        PalaceQuizQuestion(
            palace_id=palace_id,
            source_chapter_id=source_chapter_id,
            sort_order=sort_order,
        ),
        normalized,
    )


def apply_updated_question_row(
    *,
    row: PalaceQuizQuestion,
    normalized: dict[str, Any],
) -> PalaceQuizQuestion:
    apply_normalized_question_to_row(row, normalized)
    row.updated_at = utc_now_naive()
    return row


def upsert_classified_question_copy_row(
    session: Session,
    *,
    row: PalaceQuizQuestion,
    source_question: PalaceQuizQuestion,
) -> PalaceQuizQuestion:
    copy_question_content(source_question, row)
    row.updated_at = utc_now_naive()
    session.flush()
    return row


__all__ = [
    "apply_updated_question_row",
    "build_normalized_question_row",
    "upsert_classified_question_copy_row",
]
