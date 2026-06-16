from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from .question_contracts import PalaceQuizValidationError
from .question_scope_validation import (
    get_chapter_or_raise,
    normalize_classified_chapter_id,
    normalize_mini_palace_id,
    normalize_origin_question_id,
    normalize_source_chapter_id,
    validate_mini_palace,
)


@dataclass(frozen=True, slots=True)
class NormalizedQuestionScope:
    mini_palace_id: int | None
    source_chapter_id: int | None
    classified_chapter_id: int | None
    origin_question_id: int | None


def resolve_question_scope(
    payload: dict[str, object],
    *,
    session: Session | None = None,
    palace_id: int | None = None,
    source_chapter_id: int | None = None,
) -> NormalizedQuestionScope:
    mini_palace_id = normalize_mini_palace_id(
        session,
        palace_id,
        payload.get("mini_palace_id"),
    )
    resolved_source_chapter_id = normalize_source_chapter_id(
        session,
        payload.get("source_chapter_id", source_chapter_id),
    )
    classified_chapter_id = normalize_classified_chapter_id(
        session,
        resolved_source_chapter_id,
        payload.get("classified_chapter_id"),
    )
    origin_question_id = normalize_origin_question_id(
        session,
        palace_id,
        payload.get("origin_question_id"),
    )
    if session is not None and palace_id is None and resolved_source_chapter_id is None:
        raise PalaceQuizValidationError("题目必须至少归属于一个宫殿或章节。")
    if resolved_source_chapter_id is not None and mini_palace_id is not None:
        raise PalaceQuizValidationError("章节题暂不支持绑定小宫殿。")
    return NormalizedQuestionScope(
        mini_palace_id=mini_palace_id,
        source_chapter_id=resolved_source_chapter_id,
        classified_chapter_id=classified_chapter_id,
        origin_question_id=origin_question_id,
    )


__all__ = [
    "get_chapter_or_raise",
    "NormalizedQuestionScope",
    "resolve_question_scope",
    "validate_mini_palace",
]
