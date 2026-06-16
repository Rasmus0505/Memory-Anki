"""Facade for mini-palace quiz grouping runtimes."""

from __future__ import annotations

from .quiz_grouping_ai_runtime import (
    group_questions_by_mini_palaces as group_questions_by_mini_palaces,
)
from .quiz_grouping_existing_questions import (
    classify_existing_quiz_questions_to_mini_palaces as classify_existing_quiz_questions_to_mini_palaces,
)

__all__ = [
    "classify_existing_quiz_questions_to_mini_palaces",
    "group_questions_by_mini_palaces",
]
