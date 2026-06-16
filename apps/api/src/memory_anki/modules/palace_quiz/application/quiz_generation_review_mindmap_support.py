"""Review-mindmap generation rules and prompt helpers."""

from __future__ import annotations

from typing import Any

from memory_anki.modules.settings.application.ai_prompt_templates import (
    build_palace_quiz_review_mindmap_prompt,
)

from .service import (
    QUESTION_TYPES,
    PalaceQuizValidationError,
)

REVIEW_MINDMAP_QUESTION_TYPES = {
    "multiple_choice": "选择题",
    "true_false": "判断题",
    "fill_blank": "填空题",
    "matching": "连线题",
    "ordering": "排序题",
    "categorization": "归类题",
    "short_answer": "简答题",
}


def normalize_review_mindmap_mode(raw_mode: Any) -> str:
    normalized_mode = str(raw_mode or "chapter").strip()
    if normalized_mode not in {"chapter", "cross_palace"}:
        raise PalaceQuizValidationError("做题休息模式必须是 chapter 或 cross_palace。")
    return normalized_mode


def normalize_review_mindmap_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in REVIEW_MINDMAP_QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    if not normalized:
        normalized = list(REVIEW_MINDMAP_QUESTION_TYPES.keys())
    invalid = [item for item in normalized if item not in QUESTION_TYPES]
    if invalid:
        raise PalaceQuizValidationError("包含暂不支持的题型：" + "、".join(invalid))
    return normalized


def normalize_review_mindmap_question_count(raw_question_count: Any) -> int:
    try:
        question_count = int(raw_question_count)
    except (TypeError, ValueError):
        question_count = 5
    return max(1, min(question_count, 12))


def review_mindmap_system_prompt() -> str:
    return build_palace_quiz_review_mindmap_prompt()


__all__ = [
    "REVIEW_MINDMAP_QUESTION_TYPES",
    "normalize_review_mindmap_mode",
    "normalize_review_mindmap_question_count",
    "normalize_review_mindmap_question_types",
    "review_mindmap_system_prompt",
]
