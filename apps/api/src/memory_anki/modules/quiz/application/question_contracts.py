from __future__ import annotations

import json
from typing import Any

QUESTION_TYPE_MULTIPLE_CHOICE = "multiple_choice"
QUESTION_TYPE_SHORT_ANSWER = "short_answer"
QUESTION_TYPE_TRUE_FALSE = "true_false"
QUESTION_TYPE_FILL_BLANK = "fill_blank"
QUESTION_TYPE_MATCHING = "matching"
QUESTION_TYPE_ORDERING = "ordering"
QUESTION_TYPE_CATEGORIZATION = "categorization"
QUESTION_TYPES = {
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPE_TRUE_FALSE,
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_CATEGORIZATION,
}


class PalaceQuizValidationError(ValueError):
    pass


class PalaceQuizNotFoundError(LookupError):
    pass


def json_dump(value: Any, *, default: Any) -> str:
    payload = default if value is None else value
    return json.dumps(payload, ensure_ascii=False)


def json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return default if parsed is None else parsed


__all__ = [
    "PalaceQuizNotFoundError",
    "PalaceQuizValidationError",
    "QUESTION_TYPE_CATEGORIZATION",
    "QUESTION_TYPE_FILL_BLANK",
    "QUESTION_TYPE_MATCHING",
    "QUESTION_TYPE_MULTIPLE_CHOICE",
    "QUESTION_TYPE_ORDERING",
    "QUESTION_TYPE_SHORT_ANSWER",
    "QUESTION_TYPE_TRUE_FALSE",
    "QUESTION_TYPES",
    "json_dump",
    "json_load",
]
