from __future__ import annotations

from typing import Any

from .question_answer_payload_validation import (
    normalize_answer_payload as normalize_answer_payload,
)
from .question_contracts import (
    PalaceQuizValidationError,
    QUESTION_TYPES,
)
from .question_option_validation import (
    normalize_options as normalize_options,
)


def normalize_question_type(value: Any) -> str:
    normalized = str(value or "").strip()
    if normalized not in QUESTION_TYPES:
        raise PalaceQuizValidationError(
            "题型必须是 multiple_choice、short_answer、true_false、fill_blank、matching、ordering 或 categorization。"
        )
    return normalized


__all__ = [
    "normalize_answer_payload",
    "normalize_options",
    "normalize_question_type",
]
