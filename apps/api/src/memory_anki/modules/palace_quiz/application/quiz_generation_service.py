"""Public entrypoints for palace quiz AI generation flows."""

from __future__ import annotations

from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log as get_external_ai_call_log,
)

from .quiz_generation_feedback import generate_short_answer_feedback
from .quiz_generation_images import generate_quiz_preview_from_images
from .quiz_generation_review import (
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_review_mindmap,
)
from .quiz_generation_text_files import generate_quiz_preview_from_text_files

__all__ = [
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_images",
    "generate_quiz_preview_from_review_mindmap",
    "generate_quiz_preview_from_text_files",
    "generate_short_answer_feedback",
    "get_external_ai_call_log",
]
