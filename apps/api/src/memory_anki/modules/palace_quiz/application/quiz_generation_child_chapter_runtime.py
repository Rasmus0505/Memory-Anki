"""Facade for child-chapter grouping runtime helpers."""

from __future__ import annotations

from .quiz_generation_child_chapter_ai_runtime import (
    group_questions_by_child_chapters as group_questions_by_child_chapters,
)
from .quiz_generation_child_chapter_log_reuse import (
    reuse_grouped_child_chapter_questions_from_log as reuse_grouped_child_chapter_questions_from_log,
)


__all__ = [
    "group_questions_by_child_chapters",
    "reuse_grouped_child_chapter_questions_from_log",
]
