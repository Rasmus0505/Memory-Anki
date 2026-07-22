"""Compatibility facade for shared AI question-generation helpers."""

from __future__ import annotations

from .generation.shared import (
    PalaceQuizAiError as PalaceQuizAiError,
)
from .generation.shared import (
    build_generation_source_meta as build_generation_source_meta,
)
from .generation.shared import (
    extract_mini_palace_grouping_payload as extract_mini_palace_grouping_payload,
)
from .generation.shared import (
    extract_questions_payload as extract_questions_payload,
)
from .generation.shared import (
    finalize_generation_source_meta as finalize_generation_source_meta,
)
from .generation.shared import (
    normalize_generated_question_drafts as normalize_generated_question_drafts,
)

__all__ = [
    "PalaceQuizAiError",
    "build_generation_source_meta",
    "extract_mini_palace_grouping_payload",
    "extract_questions_payload",
    "finalize_generation_source_meta",
    "normalize_generated_question_drafts",
]
