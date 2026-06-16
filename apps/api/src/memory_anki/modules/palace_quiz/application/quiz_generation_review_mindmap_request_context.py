"""Context loading for review-mindmap quiz generation requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .quiz_generation_review_mindmap_context import (
    build_related_palace_summaries,
    compact_mindmap_for_prompt,
)
from .quiz_generation_review_mindmap_support import (
    normalize_review_mindmap_mode,
    normalize_review_mindmap_question_count,
    normalize_review_mindmap_question_types,
)
from .service import (
    PalaceQuizValidationError,
    get_palace_or_raise,
)


@dataclass(frozen=True, slots=True)
class ReviewMindmapRequestContext:
    palace: Any
    normalized_mode: str
    normalized_question_types: list[str]
    normalized_question_count: int
    current_mindmap: list[dict[str, Any]]
    related_summaries: list[dict[str, Any]]


def load_review_mindmap_request_context(
    session: Session,
    *,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None,
) -> ReviewMindmapRequestContext:
    palace = get_palace_or_raise(session, palace_id)
    normalized_mode = normalize_review_mindmap_mode(mode)
    normalized_question_types = normalize_review_mindmap_question_types(question_types)
    normalized_question_count = normalize_review_mindmap_question_count(question_count)
    current_mindmap = compact_mindmap_for_prompt(review_editor_doc)
    related_summaries = (
        build_related_palace_summaries(
            session,
            current_palace_id=palace_id,
            related_palace_ids=related_palace_ids or [],
        )
        if normalized_mode == "cross_palace"
        else []
    )
    if normalized_mode == "cross_palace" and not related_summaries:
        raise PalaceQuizValidationError("跨宫殿联系模式至少需要一个可用的关联宫殿摘要。")
    return ReviewMindmapRequestContext(
        palace=palace,
        normalized_mode=normalized_mode,
        normalized_question_types=normalized_question_types,
        normalized_question_count=normalized_question_count,
        current_mindmap=current_mindmap,
        related_summaries=related_summaries,
    )


__all__ = [
    "load_review_mindmap_request_context",
    "ReviewMindmapRequestContext",
]
