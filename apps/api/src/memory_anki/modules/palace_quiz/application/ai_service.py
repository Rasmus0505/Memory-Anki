"""Facade for palace-quiz AI runtime helpers and public generation entrypoints."""

from __future__ import annotations

from ._question_utils import (
    PalaceQuizAiError as PalaceQuizAiError,
    build_generation_source_meta as _build_generation_source_meta,
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .ai_service_runtime import (
    QuizStreamEvent as QuizStreamEvent,
    _build_chat_config as _build_chat_config,
    _call_logged_chat_completion as _call_logged_chat_completion,
    _call_logged_chat_completion_stream as _call_logged_chat_completion_stream,
    render_selected_pdf_pages as render_selected_pdf_pages,
)
from .quiz_generation_service import (
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_pdf,
    generate_quiz_preview_from_pdf_events,
    generate_quiz_preview_from_review_mindmap,
    generate_short_answer_feedback,
    recover_quiz_questions_from_ai_call_log_and_save,
    recover_quiz_preview_from_ai_call_log,
)


def classify_existing_quiz_questions_to_mini_palaces(*args, **kwargs):
    from .quiz_grouping_service import classify_existing_quiz_questions_to_mini_palaces as impl

    return impl(*args, **kwargs)


__all__ = [
    "PalaceQuizAiError",
    "QuizStreamEvent",
    "_build_chat_config",
    "_build_generation_source_meta",
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
    "_normalize_generated_question_drafts",
    "classify_existing_quiz_questions_to_mini_palaces",
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_images",
    "generate_quiz_preview_from_pdf",
    "generate_quiz_preview_from_pdf_events",
    "generate_quiz_preview_from_review_mindmap",
    "generate_short_answer_feedback",
    "recover_quiz_preview_from_ai_call_log",
    "recover_quiz_questions_from_ai_call_log_and_save",
    "render_selected_pdf_pages",
]
