from __future__ import annotations

import json
from typing import Any

from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    extract_first_json_object,
)

from .question_generation_errors import PalaceQuizAiError


def _extract_json_object(
    response_text: str,
    *,
    parse_error_message: str,
    type_error_message: str,
) -> dict[str, Any]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError(parse_error_message) from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError(type_error_message)
    return parsed


def extract_questions_payload(response_text: str) -> list[dict[str, Any]]:
    parsed = _extract_json_object(
        response_text,
        parse_error_message="AI 返回的做题 JSON 无法解析。",
        type_error_message="AI 返回的做题结果不是对象。",
    )
    questions = parsed.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    normalized_questions: list[dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            raise PalaceQuizAiError("AI 返回的题目列表格式不正确。")
        normalized_questions.append(item)
    return normalized_questions


def extract_mini_palace_grouping_payload(response_text: str) -> dict[str, Any]:
    parsed = _extract_json_object(
        response_text,
        parse_error_message="AI 返回的小宫殿归类 JSON 无法解析。",
        type_error_message="AI 返回的小宫殿归类结果不是对象。",
    )
    groups = parsed.get("mini_palace_groups")
    unassigned = parsed.get("unassigned_question_indexes")
    if not isinstance(groups, list) or not isinstance(unassigned, list):
        raise PalaceQuizAiError("AI 返回的小宫殿归类结果缺少必需字段。")
    return parsed


__all__ = [
    "extract_mini_palace_grouping_payload",
    "extract_questions_payload",
]
