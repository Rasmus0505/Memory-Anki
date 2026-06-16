from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError


def _normalize_option_id(index: int) -> str:
    if 0 <= index < 26:
        return chr(ord("A") + index)
    return f"OPTION_{index + 1}"


def normalize_options(raw_options: Any) -> list[dict[str, str]]:
    if raw_options is None:
        return []
    if not isinstance(raw_options, list):
        raise PalaceQuizValidationError("选择题选项必须是数组。")
    normalized: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_options):
        if isinstance(item, dict):
            option_id = str(item.get("id") or "").strip() or _normalize_option_id(index)
            option_text = str(item.get("text") or "").strip()
        else:
            option_id = _normalize_option_id(index)
            option_text = str(item or "").strip()
        if not option_text:
            raise PalaceQuizValidationError("选择题每个选项都必须填写内容。")
        if option_id in seen_ids:
            raise PalaceQuizValidationError("选择题选项 id 不能重复。")
        seen_ids.add(option_id)
        normalized.append({"id": option_id, "text": option_text})
    return normalized


__all__ = ["normalize_options"]
