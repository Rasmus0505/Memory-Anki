"""Compatibility facade for shared AI question-generation helpers."""

from __future__ import annotations

from .question_generation_drafts import (
    normalize_generated_question_drafts as normalize_generated_question_drafts,
)
from .question_generation_errors import (
    PalaceQuizAiError as PalaceQuizAiError,
)
from .question_generation_payloads import (
    extract_mini_palace_grouping_payload as extract_mini_palace_grouping_payload,
    extract_questions_payload as extract_questions_payload,
)
from .question_generation_source_meta import (
    build_generation_source_meta as build_generation_source_meta,
    finalize_generation_source_meta as finalize_generation_source_meta,
)

__all__ = [
    "PalaceQuizAiError",
    "build_generation_source_meta",
    "extract_mini_palace_grouping_payload",
    "extract_questions_payload",
    "finalize_generation_source_meta",
    "normalize_generated_question_drafts",
]
