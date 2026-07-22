"""Facade for quiz question grouping into mini-palaces."""

from __future__ import annotations

from .grouping.classify import (
    build_grouped_preview_from_indexes as build_grouped_preview_from_indexes,
)
from .grouping.classify import (
    build_mini_palace_context as build_mini_palace_context,
)
from .grouping.classify import (
    classify_existing_quiz_questions_to_mini_palaces as classify_existing_quiz_questions_to_mini_palaces,
)
from .grouping.classify import (
    group_questions_by_mini_palaces as group_questions_by_mini_palaces,
)
from .grouping.classify import (
    question_payload_for_grouping as question_payload_for_grouping,
)

__all__ = [
    "build_grouped_preview_from_indexes",
    "build_mini_palace_context",
    "classify_existing_quiz_questions_to_mini_palaces",
    "group_questions_by_mini_palaces",
    "question_payload_for_grouping",
]
