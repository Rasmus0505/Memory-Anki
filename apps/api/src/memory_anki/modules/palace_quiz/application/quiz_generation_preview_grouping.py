"""Shared grouping runtime helpers for quiz-generation preview flows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_chaptering import group_questions_by_child_chapters
from .service import PalaceQuizValidationError


def _grouping_service():
    from . import quiz_grouping_service

    return quiz_grouping_service


def require_child_chapter_contexts(
    child_contexts: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
    return child_contexts


def group_questions_for_child_chapter_preview(
    session: Session,
    *,
    drafts: list[dict[str, Any]],
    child_contexts: list[dict[str, object]],
    feature: str,
    operation: str,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    return group_questions_by_child_chapters(
        session,
        drafts=drafts,
        child_contexts=require_child_chapter_contexts(child_contexts),
        feature=feature,
        operation=operation,
        ai_options=ai_options,
    )


def group_questions_for_preview_scope(
    session: Session,
    *,
    palace: Any,
    drafts: list[dict[str, Any]],
    selected_chapter: Any = None,
    child_contexts: list[dict[str, object]] | None = None,
    feature: str,
    child_chapter_operation: str,
    mini_palace_operation: str,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    if selected_chapter is not None:
        return group_questions_for_child_chapter_preview(
            session,
            drafts=drafts,
            child_contexts=list(child_contexts or []),
            feature=feature,
            operation=child_chapter_operation,
            ai_options=ai_options,
        )
    return _grouping_service().group_questions_by_mini_palaces(
        session,
        palace=palace,
        questions=drafts,
        operation=mini_palace_operation,
        ai_options=ai_options,
    )[0]


__all__ = [
    "group_questions_for_child_chapter_preview",
    "group_questions_for_preview_scope",
    "require_child_chapter_contexts",
]
