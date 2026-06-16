"""Facade for review-mindmap and chapter-outline quiz generation flows."""

from __future__ import annotations

from .quiz_generation_chapter_outline import (
    chapter_outline_payload as chapter_outline_payload,
    generate_quiz_preview_from_chapter_outline as generate_quiz_preview_from_chapter_outline,
    normalize_outline_question_count as normalize_outline_question_count,
    normalize_outline_question_types as normalize_outline_question_types,
)
from .quiz_generation_review_mindmap import (
    REVIEW_MINDMAP_QUESTION_TYPES as REVIEW_MINDMAP_QUESTION_TYPES,
    build_related_palace_summaries as build_related_palace_summaries,
    compact_mindmap_for_prompt as compact_mindmap_for_prompt,
    generate_quiz_preview_from_review_mindmap as generate_quiz_preview_from_review_mindmap,
    normalize_review_mindmap_question_count as normalize_review_mindmap_question_count,
    normalize_review_mindmap_question_types as normalize_review_mindmap_question_types,
    review_mindmap_system_prompt as review_mindmap_system_prompt,
)

__all__ = [
    "REVIEW_MINDMAP_QUESTION_TYPES",
    "build_related_palace_summaries",
    "chapter_outline_payload",
    "compact_mindmap_for_prompt",
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_review_mindmap",
    "normalize_outline_question_count",
    "normalize_outline_question_types",
    "normalize_review_mindmap_question_count",
    "normalize_review_mindmap_question_types",
    "review_mindmap_system_prompt",
]
