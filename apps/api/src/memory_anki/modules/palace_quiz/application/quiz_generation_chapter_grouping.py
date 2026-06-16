"""Facade for child-chapter grouping helpers."""

from __future__ import annotations

from .quiz_generation_child_chapter_context import (
    flatten_child_chapter_contexts as flatten_child_chapter_contexts,
)
from .quiz_generation_child_chapter_preview import (
    build_group_questions_by_child_chapter_preview as build_group_questions_by_child_chapter_preview,
)
from .quiz_generation_child_chapter_runtime import (
    group_questions_by_child_chapters as group_questions_by_child_chapters,
    reuse_grouped_child_chapter_questions_from_log as reuse_grouped_child_chapter_questions_from_log,
)

__all__ = [
    "build_group_questions_by_child_chapter_preview",
    "flatten_child_chapter_contexts",
    "group_questions_by_child_chapters",
    "reuse_grouped_child_chapter_questions_from_log",
]
