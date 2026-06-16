"""PDF candidate payload parsing helpers."""

from __future__ import annotations

import json
from typing import Any

from .service import PalaceQuizValidationError


def extract_pdf_candidate_lists(
    vision_draft_text: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        parsed = json.loads(vision_draft_text)
    except json.JSONDecodeError as exc:
        raise PalaceQuizValidationError("AI 日志里的候选题 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizValidationError("AI 日志里的候选题格式不正确。")
    question_candidates = (
        [item for item in parsed.get("question_candidates") if isinstance(item, dict)]
        if isinstance(parsed.get("question_candidates"), list)
        else []
    )
    answer_candidates = (
        [item for item in parsed.get("answer_candidates") if isinstance(item, dict)]
        if isinstance(parsed.get("answer_candidates"), list)
        else []
    )
    if not question_candidates:
        raise PalaceQuizValidationError("AI 日志里没有可恢复的题目候选。")
    return question_candidates, answer_candidates


__all__ = ["extract_pdf_candidate_lists"]
