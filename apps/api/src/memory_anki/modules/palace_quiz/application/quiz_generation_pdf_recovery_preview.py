"""Preview entrypoint for PDF quiz recovery flows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_preview import project_pdf_generation_preview_result
from .quiz_generation_pdf_recovery_runtime import build_pdf_recovery_draft_state
from .quiz_generation_pdf_recovery_support import load_pdf_recovery_context


def recover_quiz_preview_from_ai_call_log(
    session: Session,
    *,
    palace_id: int,
    ai_call_log_id: str,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    from . import quiz_generation_service

    context = load_pdf_recovery_context(
        session,
        palace_id=palace_id,
        ai_call_log_id=ai_call_log_id,
        selected_chapter_id=selected_chapter_id,
        get_ai_call_log=quiz_generation_service.get_external_ai_call_log,
    )
    draft_state = build_pdf_recovery_draft_state(
        session,
        palace_id=palace_id,
        context=context,
        ai_options=ai_options,
    )
    return project_pdf_generation_preview_result(
        session,
        palace=context.palace,
        palace_id=palace_id,
        log_id=ai_call_log_id,
        source_meta=context.recovered_source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=context.selected_chapter,
        ai_options=ai_options,
        drafts=draft_state.drafts,
        warnings=draft_state.warnings,
        generation_stats=draft_state.generation_stats,
        resolved_ai_steps={"pairing": draft_state.pairing_resolved_ai},
        vision_draft_text=context.vision_draft_text,
    )


__all__ = ["recover_quiz_preview_from_ai_call_log"]
