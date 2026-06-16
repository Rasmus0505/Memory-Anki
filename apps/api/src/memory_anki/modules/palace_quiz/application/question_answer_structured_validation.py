from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError


def normalize_matching_answer(payload: dict[str, Any]) -> dict[str, Any]:
    pairs_raw = payload.get("pairs")
    if not isinstance(pairs_raw, list) or len(pairs_raw) < 2:
        raise PalaceQuizValidationError("连线题至少需要 2 组配对。")
    pairs: list[dict[str, str]] = []
    seen_left: set[str] = set()
    seen_right: set[str] = set()
    for index, item in enumerate(pairs_raw):
        if not isinstance(item, dict):
            raise PalaceQuizValidationError("连线题 pairs 格式不正确。")
        left_id = str(item.get("left_id") or f"L{index + 1}").strip()
        right_id = str(item.get("right_id") or f"R{index + 1}").strip()
        left = str(item.get("left") or "").strip()
        right = str(item.get("right") or "").strip()
        if not left_id or not right_id or not left or not right:
            raise PalaceQuizValidationError("连线题每组配对都必须有左右文本。")
        if left_id in seen_left or right_id in seen_right:
            raise PalaceQuizValidationError("连线题左右 id 不能重复。")
        seen_left.add(left_id)
        seen_right.add(right_id)
        pairs.append(
            {"left_id": left_id, "left": left, "right_id": right_id, "right": right}
        )
    return {"pairs": pairs}


def normalize_ordering_answer(payload: dict[str, Any]) -> dict[str, Any]:
    items_raw = payload.get("items")
    correct_order_raw = payload.get("correct_order_ids") or payload.get("correct_order")
    if not isinstance(items_raw, list) or len(items_raw) < 2:
        raise PalaceQuizValidationError("排序题至少需要 2 个项目。")
    items: list[dict[str, str]] = []
    for index, item in enumerate(items_raw):
        if isinstance(item, dict):
            item_id = str(item.get("id") or f"item_{index + 1}").strip()
            text = str(item.get("text") or "").strip()
        else:
            item_id = f"item_{index + 1}"
            text = str(item or "").strip()
        if not item_id or not text:
            raise PalaceQuizValidationError("排序题每个项目都必须有文本。")
        items.append({"id": item_id, "text": text})
    item_ids = [item["id"] for item in items]
    correct_order_ids = (
        [str(item).strip() for item in correct_order_raw if str(item).strip()]
        if isinstance(correct_order_raw, list)
        else item_ids
    )
    if set(correct_order_ids) != set(item_ids) or len(correct_order_ids) != len(item_ids):
        raise PalaceQuizValidationError("排序题正确顺序必须包含全部项目 id。")
    return {"items": items, "correct_order_ids": correct_order_ids}


def normalize_categorization_answer(payload: dict[str, Any]) -> dict[str, Any]:
    categories_raw = payload.get("categories")
    items_raw = payload.get("items")
    if not isinstance(categories_raw, list) or len(categories_raw) < 2:
        raise PalaceQuizValidationError("归类题至少需要 2 个分类。")
    if not isinstance(items_raw, list) or len(items_raw) < 2:
        raise PalaceQuizValidationError("归类题至少需要 2 个待分类项目。")
    categories: list[dict[str, str]] = []
    category_ids: set[str] = set()
    for index, item in enumerate(categories_raw):
        if isinstance(item, dict):
            category_id = str(item.get("id") or f"category_{index + 1}").strip()
            name = str(item.get("name") or item.get("text") or "").strip()
        else:
            category_id = f"category_{index + 1}"
            name = str(item or "").strip()
        if not category_id or not name or category_id in category_ids:
            raise PalaceQuizValidationError("归类题分类必须有唯一 id 和名称。")
        category_ids.add(category_id)
        categories.append({"id": category_id, "name": name})
    items: list[dict[str, str]] = []
    for index, item in enumerate(items_raw):
        if not isinstance(item, dict):
            raise PalaceQuizValidationError("归类题项目格式不正确。")
        item_id = str(item.get("id") or f"item_{index + 1}").strip()
        text = str(item.get("text") or "").strip()
        category_id = str(item.get("category_id") or "").strip()
        if not item_id or not text or category_id not in category_ids:
            raise PalaceQuizValidationError("归类题每个项目都必须指向已有分类。")
        items.append({"id": item_id, "text": text, "category_id": category_id})
    return {"categories": categories, "items": items}


__all__ = [
    "normalize_categorization_answer",
    "normalize_matching_answer",
    "normalize_ordering_answer",
]
