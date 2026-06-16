from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_dedup_keys import (
    build_question_dedup_key,
    question_to_dedup_payload,
)


def find_duplicate_question(
    session: Session,
    palace_id: int | None,
    source_chapter_id: int | None,
    normalized_payload: dict[str, Any],
    *,
    exclude_question_id: int | None = None,
) -> PalaceQuizQuestion | None:
    duplicate_key = build_question_dedup_key(normalized_payload)
    query = session.query(PalaceQuizQuestion)
    if palace_id is not None:
        query = query.filter_by(
            palace_id=palace_id,
            mini_palace_id=normalized_payload["mini_palace_id"],
        )
    else:
        query = query.filter_by(
            source_chapter_id=source_chapter_id,
            classified_chapter_id=normalized_payload["classified_chapter_id"],
        )
    candidates = (
        query.order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc()).all()
    )
    for candidate in candidates:
        if exclude_question_id is not None and candidate.id == exclude_question_id:
            continue
        if build_question_dedup_key(question_to_dedup_payload(candidate)) == duplicate_key:
            return candidate
    return None


__all__ = ["find_duplicate_question"]
