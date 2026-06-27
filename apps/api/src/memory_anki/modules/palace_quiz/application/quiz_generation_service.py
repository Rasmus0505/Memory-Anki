"""Public entrypoints for palace quiz AI generation flows."""

from __future__ import annotations

from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log as get_external_ai_call_log,
)

from .quiz_generation_feedback import generate_short_answer_feedback
from .quiz_generation_images import generate_quiz_preview_from_images
from .quiz_generation_pdf_generation_stream_runtime import (
    generate_quiz_preview_from_pdf_events as generate_quiz_preview_from_pdf_events,
)
from .quiz_generation_pdf_generation_sync_runtime import (
    generate_quiz_preview_from_pdf as generate_quiz_preview_from_pdf,
)
from .quiz_generation_pdf_recovery_preview import (
    recover_quiz_preview_from_ai_call_log as recover_quiz_preview_from_ai_call_log,
)
from .quiz_generation_pdf_recovery_save import (
    recover_quiz_questions_from_ai_call_log_and_save as recover_quiz_questions_from_ai_call_log_and_save,
)
from .quiz_generation_review import (
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_review_mindmap,
)
from .quiz_generation_text_files import generate_quiz_preview_from_text_files

__all__ = [
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_images",
    "generate_quiz_preview_from_pdf",
    "generate_quiz_preview_from_pdf_events",
    "generate_quiz_preview_from_review_mindmap",
    "generate_quiz_preview_from_text_files",
    "generate_short_answer_feedback",
    "get_external_ai_call_log",
    "recover_quiz_preview_from_ai_call_log",
    "recover_quiz_questions_from_ai_call_log_and_save",
]
