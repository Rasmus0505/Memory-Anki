"""Text-file quiz generation preview normalization and grouping."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import finalize_generation_source_meta, normalize_generated_question_drafts
from .quiz_generation_chaptering import apply_source_chapter_to_drafts
from .quiz_generation_preview_grouping import group_questions_for_preview_scope
from .quiz_generation_preview_result import build_quiz_generation_preview_result
from .quiz_generation_text_request import TextGenerationPreparedRequest


def project_text_generation_preview_result(
    session: Session,
    *,
    palace: Any,
    palace_id: int,
    log_id: str,
    source_meta: dict[str, Any],
    classify_by_mini_palace: bool,
    drafts: list[dict[str, Any]],
    warnings: list[str],
    generation_stats: dict[str, Any],
    selected_chapter: Any = None,
    child_contexts: list[dict[str, Any]] | None = None,
    ai_options: AiRuntimeOptions | None = None,
    resolved_ai: dict[str, Any] | None = None,
) -> dict[str, Any]:
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    grouped_questions = None
    if classify_by_mini_palace:
        grouped_questions = group_questions_for_preview_scope(
            session,
            palace=palace,
            drafts=drafts,
            selected_chapter=selected_chapter,
            child_contexts=child_contexts,
            feature="宫殿做题",
            child_chapter_operation="palace_quiz_group_by_child_chapter",
            mini_palace_operation="ai_prompt_palace_quiz_group_by_mini_palace",
            ai_options=ai_options,
        )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=grouped_questions,
        resolved_ai=resolved_ai,
    )


def build_text_generation_preview_result(
    session: Session,
    *,
    prepared_request: TextGenerationPreparedRequest,
    palace_id: int,
    response_text: str,
    log_id: str,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=prepared_request.source_meta,
    )
    selected_chapter = prepared_request.selected_chapter
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    return project_text_generation_preview_result(
        session,
        palace=prepared_request.palace,
        palace_id=palace_id,
        log_id=log_id,
        source_meta=prepared_request.source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        drafts=drafts,
        warnings=warnings,
        generation_stats=generation_stats,
        selected_chapter=selected_chapter,
        child_contexts=prepared_request.child_contexts,
        ai_options=ai_options,
        resolved_ai=prepared_request.resolved_ai,
    )


__all__ = [
    "build_text_generation_preview_result",
    "project_text_generation_preview_result",
]
