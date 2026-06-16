from __future__ import annotations

from typing import Any

from .question_contracts import (
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPE_TRUE_FALSE,
)
from .question_answer_simple_validation import (
    normalize_fill_blank_answer,
    normalize_multiple_choice_answer,
    normalize_short_answer_payload,
    normalize_true_false_answer,
)
from .question_answer_structured_validation import (
    normalize_categorization_answer,
    normalize_matching_answer,
    normalize_ordering_answer,
)


def normalize_answer_payload(
    question_type: str,
    raw_answer_payload: Any,
    *,
    options: list[dict[str, str]],
) -> dict[str, Any]:
    payload = raw_answer_payload if isinstance(raw_answer_payload, dict) else {}
    if question_type == QUESTION_TYPE_MULTIPLE_CHOICE:
        return normalize_multiple_choice_answer(payload, options=options)
    if question_type == QUESTION_TYPE_SHORT_ANSWER:
        return normalize_short_answer_payload(payload)
    if question_type == QUESTION_TYPE_TRUE_FALSE:
        return normalize_true_false_answer(payload)
    if question_type == QUESTION_TYPE_FILL_BLANK:
        return normalize_fill_blank_answer(payload)
    if question_type == QUESTION_TYPE_MATCHING:
        return normalize_matching_answer(payload)
    if question_type == QUESTION_TYPE_ORDERING:
        return normalize_ordering_answer(payload)
    return normalize_categorization_answer(payload)


__all__ = ["normalize_answer_payload"]
