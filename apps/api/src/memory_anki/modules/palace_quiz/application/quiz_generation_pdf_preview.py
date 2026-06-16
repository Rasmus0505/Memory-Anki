"""PDF quiz preview normalization and grouping."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import (
    finalize_generation_source_meta,
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .quiz_generation_chaptering import apply_source_chapter_to_drafts
from .quiz_generation_pdf_preview_grouping import build_pdf_preview_grouped_questions
from .quiz_generation_preview_result import build_quiz_generation_preview_result


def project_pdf_generation_preview_result(
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
    ai_options: AiRuntimeOptions | None = None,
    resolved_ai_steps: dict[str, Any] | None = None,
    vision_draft_text: str | None = None,
) -> dict[str, Any]:
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    grouped_questions = None
    if classify_by_mini_palace:
        grouped_questions = build_pdf_preview_grouped_questions(
            session,
            palace=palace,
            drafts=drafts,
            selected_chapter=selected_chapter,
            vision_draft_text=vision_draft_text,
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
        resolved_ai=source_meta.get("resolved_ai"),
        extra_fields={
            "resolved_ai_steps": resolved_ai_steps or {"generation": source_meta.get("resolved_ai")}
        },
    )


def build_pdf_generation_preview_result(
    session: Session,
    *,
    palace: Any,
    palace_id: int,
    response_text: str,
    log_id: str,
    source_meta: dict[str, Any],
    classify_by_mini_palace: bool,
    selected_chapter: Any = None,
    ai_options: AiRuntimeOptions | None = None,
    resolved_ai_steps: dict[str, Any] | None = None,
    vision_draft_text: str | None = None,
) -> dict[str, Any]:
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    return project_pdf_generation_preview_result(
        session,
        palace=palace,
        palace_id=palace_id,
        log_id=log_id,
        source_meta=source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        drafts=drafts,
        warnings=warnings,
        generation_stats=generation_stats,
        selected_chapter=selected_chapter,
        ai_options=ai_options,
        resolved_ai_steps=resolved_ai_steps,
        vision_draft_text=vision_draft_text,
    )


__all__ = [
    "build_pdf_generation_preview_result",
    "project_pdf_generation_preview_result",
]
