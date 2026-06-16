"""Context loading for chapter-outline quiz generation requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter

from .quiz_generation_chapter_outline_support import (
    normalize_outline_question_count,
    normalize_outline_question_types,
)
from .quiz_generation_chaptering import flatten_child_chapter_contexts
from .service import (
    PalaceQuizValidationError,
    get_chapter_or_raise,
)


@dataclass(frozen=True, slots=True)
class ChapterOutlineRequestContext:
    chapter: Chapter
    normalized_question_types: list[str]
    normalized_question_count: int
    child_contexts: list[dict[str, Any]]


def load_chapter_outline_request_context(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    classify_by_child_chapter: bool,
) -> ChapterOutlineRequestContext:
    chapter = get_chapter_or_raise(session, chapter_id)
    normalized_question_types = normalize_outline_question_types(question_types)
    normalized_question_count = normalize_outline_question_count(question_count)
    child_contexts = flatten_child_chapter_contexts(chapter)
    if classify_by_child_chapter and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前章节没有下级小节，暂时无法按宫殿分类。")
    return ChapterOutlineRequestContext(
        chapter=chapter,
        normalized_question_types=normalized_question_types,
        normalized_question_count=normalized_question_count,
        child_contexts=child_contexts,
    )


__all__ = [
    "ChapterOutlineRequestContext",
    "load_chapter_outline_request_context",
]
