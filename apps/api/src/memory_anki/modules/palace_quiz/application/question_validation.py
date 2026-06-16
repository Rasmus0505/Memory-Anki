from __future__ import annotations

from sqlalchemy.orm import Session

from .question_validation_content import normalize_question_content
from .question_validation_scope import (
    get_chapter_or_raise,
    resolve_question_scope,
    validate_mini_palace,
)


def normalize_question_payload(
    payload: dict[str, object],
    *,
    default_source_meta: dict[str, object] | None = None,
    session: Session | None = None,
    palace_id: int | None = None,
    source_chapter_id: int | None = None,
) -> dict[str, object]:
    content = normalize_question_content(
        payload,
        default_source_meta=default_source_meta,
    )
    scope = resolve_question_scope(
        payload,
        session=session,
        palace_id=palace_id,
        source_chapter_id=source_chapter_id,
    )
    return {
        **content,
        "mini_palace_id": scope.mini_palace_id,
        "source_chapter_id": scope.source_chapter_id,
        "classified_chapter_id": scope.classified_chapter_id,
        "origin_question_id": scope.origin_question_id,
    }


__all__ = [
    "get_chapter_or_raise",
    "normalize_question_payload",
    "validate_mini_palace",
]
