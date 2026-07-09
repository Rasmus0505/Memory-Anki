"""Public entrypoints for palace quiz AI generation flows."""

from __future__ import annotations

from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log as get_external_ai_call_log,
)

from .generation.images import generate_quiz_preview_from_images
from .generation.review_mindmap import (
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_review_mindmap,
)
from .generation.shared import generate_short_answer_feedback
from .generation.text import generate_quiz_preview_from_text_files
from .quiz_explain_question import explain_question

__all__ = [
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_images",
    "generate_quiz_preview_from_review_mindmap",
    "generate_quiz_preview_from_text_files",
    "generate_short_answer_feedback",
    "get_external_ai_call_log",
    "explain_question",
]
