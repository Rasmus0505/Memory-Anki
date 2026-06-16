"""Preview normalization for chapter-outline quiz generation."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import (
    finalize_generation_source_meta,
    normalize_generated_question_drafts,
)
from .quiz_generation_chapter_outline_request import ChapterOutlinePreparedRequest
from .quiz_generation_chaptering import apply_source_chapter_to_drafts
from .quiz_generation_preview_grouping import group_questions_for_child_chapter_preview
from .quiz_generation_preview_result import build_quiz_generation_preview_result


def build_chapter_outline_preview_result(
    session: Session,
    *,
    prepared_request: ChapterOutlinePreparedRequest,
    chapter_id: int,
    response_text: str,
    log_id: str,
    classify_by_child_chapter: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    source_meta = prepared_request.source_meta
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    apply_source_chapter_to_drafts(drafts, chapter_id=prepared_request.chapter.id)
    grouped_questions = None
    if classify_by_child_chapter:
        grouped_questions = group_questions_for_child_chapter_preview(
            session=session,
            drafts=drafts,
            child_contexts=prepared_request.child_contexts,
            feature="章节做题",
            operation="chapter_quiz_group_by_child_chapter",
            ai_options=ai_options,
        )
        source_meta["generation_mode"] = "chapter_outline_grouped"
    return build_quiz_generation_preview_result(
        scope_key="chapter_id",
        scope_id=chapter_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=grouped_questions,
        resolved_ai=prepared_request.resolved_ai,
    )


__all__ = ["build_chapter_outline_preview_result"]
