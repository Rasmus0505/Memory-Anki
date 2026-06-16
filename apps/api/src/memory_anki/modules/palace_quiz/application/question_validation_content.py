from __future__ import annotations

from typing import Any

from .question_answer_validation import (
    normalize_answer_payload,
    normalize_options,
    normalize_question_type,
)
from .question_contracts import (
    PalaceQuizValidationError,
    QUESTION_TYPE_MULTIPLE_CHOICE,
)
from .question_source_meta import normalize_source_meta

_LEGACY_ANSWER_PAYLOAD_KEYS = (
    "correct_answer",
    "false_explanation",
    "error_explanation",
    "blanks",
    "pairs",
    "items",
    "correct_order_ids",
    "correct_order",
    "categories",
)


def build_question_answer_payload_input(payload: dict[str, Any]) -> dict[str, Any]:
    answer_payload_input = payload.get("answer_payload")
    if not isinstance(answer_payload_input, dict):
        answer_payload_input = {}
    if "correct_option_id" in payload and "correct_option_id" not in answer_payload_input:
        answer_payload_input["correct_option_id"] = payload.get("correct_option_id")
    if "reference_answer" in payload and "reference_answer" not in answer_payload_input:
        answer_payload_input["reference_answer"] = payload.get("reference_answer")
    for key in _LEGACY_ANSWER_PAYLOAD_KEYS:
        if key in payload and key not in answer_payload_input:
            answer_payload_input[key] = payload.get(key)
    return answer_payload_input


def normalize_question_content(
    payload: dict[str, Any],
    *,
    default_source_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    question_type = normalize_question_type(payload.get("question_type"))
    stem = str(payload.get("stem") or "").strip()
    if not stem:
        raise PalaceQuizValidationError("题干不能为空。")
    options = normalize_options(payload.get("options"))
    answer_payload = normalize_answer_payload(
        question_type,
        build_question_answer_payload_input(payload),
        options=options,
    )
    if question_type != QUESTION_TYPE_MULTIPLE_CHOICE:
        options = []
    return {
        "question_type": question_type,
        "stem": stem,
        "options": options,
        "answer_payload": answer_payload,
        "analysis": str(payload.get("analysis") or "").strip(),
        "source_meta": normalize_source_meta(
            payload.get("source_meta")
            if payload.get("source_meta") is not None
            else default_source_meta
        ),
    }


__all__ = [
    "build_question_answer_payload_input",
    "normalize_question_content",
]
