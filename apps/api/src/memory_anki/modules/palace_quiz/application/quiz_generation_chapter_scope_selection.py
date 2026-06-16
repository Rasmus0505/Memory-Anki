"""Selection and explicit-scope validation for chapter-based quiz generation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
)

from .service import (
    PalaceQuizValidationError,
    get_chapter_or_raise,
)


def chapter_belongs_to_explicit_scope(chapter: Chapter, explicit_ids: set[int]) -> bool:
    current: Chapter | None = chapter
    while current is not None:
        if current.id in explicit_ids:
            return True
        current = current.parent
    return False


def chapter_contains_explicit_scope(
    session: Session,
    *,
    chapter: Chapter,
    explicit_ids: set[int],
) -> bool:
    for explicit_id in explicit_ids:
        explicit_chapter = get_chapter_or_raise(session, explicit_id)
        current: Chapter | None = explicit_chapter
        while current is not None:
            if current.id == chapter.id:
                return True
            current = current.parent
    return False


def resolve_selected_generation_chapter(
    session: Session,
    *,
    palace: Palace,
    selected_chapter_id: int | None,
) -> Chapter | None:
    if selected_chapter_id is None:
        return None
    chapter = get_chapter_or_raise(session, selected_chapter_id)
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    if not explicit_ids:
        raise PalaceQuizValidationError("当前宫殿还没有绑定可用章节，无法选择题目所属范围。")
    if not chapter_belongs_to_explicit_scope(
        chapter,
        explicit_ids,
    ) and not chapter_contains_explicit_scope(
        session,
        chapter=chapter,
        explicit_ids=explicit_ids,
    ):
        raise PalaceQuizValidationError("所选章节不在当前宫殿已绑定的章节范围内。")
    return chapter


__all__ = [
    "chapter_belongs_to_explicit_scope",
    "chapter_contains_explicit_scope",
    "resolve_selected_generation_chapter",
]
