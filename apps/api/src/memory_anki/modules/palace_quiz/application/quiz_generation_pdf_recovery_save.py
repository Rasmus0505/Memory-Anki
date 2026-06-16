"""Save orchestration for PDF quiz recovery flows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_recovery_grouping import build_pdf_recovery_grouping_result
from .quiz_generation_pdf_recovery_projection import (
    build_pdf_recovery_save_result,
    build_recovered_questions_to_save,
)
from .quiz_generation_pdf_recovery_runtime import build_pdf_recovery_draft_state
from .quiz_generation_pdf_recovery_support import load_pdf_recovery_context
from .service import (
    PalaceQuizValidationError,
    batch_create_chapter_questions,
)


def recover_quiz_questions_from_ai_call_log_and_save(
    session: Session,
    *,
    palace_id: int,
    ai_call_log_id: str,
    selected_chapter_id: int,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    if selected_chapter_id <= 0:
        raise PalaceQuizValidationError("请先选择要写入的章节范围。")
    context = load_pdf_recovery_context(
        session,
        palace_id=palace_id,
        ai_call_log_id=ai_call_log_id,
        selected_chapter_id=selected_chapter_id,
    )
    draft_state = build_pdf_recovery_draft_state(
        session,
        palace_id=palace_id,
        context=context,
        ai_options=ai_options,
    )
    grouping_result = build_pdf_recovery_grouping_result(
        vision_draft_text=context.vision_draft_text,
        drafts=draft_state.drafts,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=context.selected_chapter,
    )
    questions_to_save = build_recovered_questions_to_save(
        drafts=draft_state.drafts,
        grouped_questions=grouping_result.grouped_questions,
        source_chapter_id=context.selected_chapter.id,
    )
    items = batch_create_chapter_questions(
        session,
        context.selected_chapter.id,
        questions_to_save,
    )
    return build_pdf_recovery_save_result(
        items=items,
        ai_call_log_id=ai_call_log_id,
        questions_to_save=questions_to_save,
        grouped_questions=grouping_result.grouped_questions,
        generation_stats=draft_state.generation_stats,
        warnings=draft_state.warnings,
        skipped_reasons=grouping_result.skipped_reasons,
    )


__all__ = [
    "recover_quiz_questions_from_ai_call_log_and_save",
]
