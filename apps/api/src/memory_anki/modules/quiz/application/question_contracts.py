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

# Bank practice / manage / preview order: objective types first, short answer last.
QUESTION_TYPE_DISPLAY_ORDER = (
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_TRUE_FALSE,
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_CATEGORIZATION,
    QUESTION_TYPE_SHORT_ANSWER,
)
QUESTION_TYPE_DISPLAY_RANKS = {
    question_type: index for index, question_type in enumerate(QUESTION_TYPE_DISPLAY_ORDER)
}


def question_type_display_rank(question_type: str | None) -> int:
    return QUESTION_TYPE_DISPLAY_RANKS.get(str(question_type or "").strip(), 99)


def sort_questions_for_bank_display(items: list[Any]) -> list[Any]:
    def sort_key(item: Any) -> tuple[int, int, int]:
        if isinstance(item, dict):
            question_type = item.get("question_type")
            sort_order = item.get("sort_order") or 0
            question_id = item.get("id") or 0
        else:
            question_type = getattr(item, "question_type", "")
            sort_order = getattr(item, "sort_order", 0) or 0
            question_id = getattr(item, "id", 0) or 0
        return (
            question_type_display_rank(str(question_type or "")),
            int(sort_order),
            int(question_id),
        )

    return sorted(items, key=sort_key)


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
    "QUESTION_TYPE_DISPLAY_ORDER",
    "QUESTION_TYPE_DISPLAY_RANKS",
    "json_dump",
    "json_load",
    "question_type_display_rank",
    "sort_questions_for_bank_display",
]
