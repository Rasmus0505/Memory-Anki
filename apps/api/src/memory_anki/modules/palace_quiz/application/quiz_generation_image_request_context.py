"""Context loading for image-based quiz generation requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .quiz_generation_chaptering import (
    flatten_child_chapter_contexts,
    resolve_selected_generation_chapter,
)
from .service import (
    PalaceQuizValidationError,
    get_palace_or_raise,
)


@dataclass(frozen=True, slots=True)
class ImageGenerationRequestContext:
    palace: Any
    selected_chapter: Any
    child_contexts: list[dict[str, Any]]


def load_image_generation_request_context(
    session: Session,
    *,
    palace_id: int,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
) -> ImageGenerationRequestContext:
    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
    child_contexts = (
        flatten_child_chapter_contexts(selected_chapter) if selected_chapter is not None else []
    )
    if selected_chapter is not None and classify_by_mini_palace and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
    return ImageGenerationRequestContext(
        palace=palace,
        selected_chapter=selected_chapter,
        child_contexts=child_contexts,
    )


__all__ = [
    "ImageGenerationRequestContext",
    "load_image_generation_request_context",
]
