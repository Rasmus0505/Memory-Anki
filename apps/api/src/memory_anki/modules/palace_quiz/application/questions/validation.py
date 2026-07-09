"""Question validation and normalization helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..question_contracts import (
    QUESTION_TYPE_CATEGORIZATION,
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPE_TRUE_FALSE,
    QUESTION_TYPES,
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    json_dump,
    json_load,
)
from ..question_scope_ids import normalize_optional_int
from .scope import (
    get_chapter_or_raise,
    normalize_classified_chapter_id,
    normalize_mini_palace_id,
    normalize_origin_question_id,
    normalize_source_chapter_id,
    validate_mini_palace,
)
from .source_meta import normalize_source_meta

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


def normalize_multiple_choice_answer(
    payload: dict[str, Any],
    *,
    options: list[dict[str, str]],
) -> dict[str, Any]:
    correct_option_id = str(payload.get("correct_option_id") or "").strip()
    if len(options) < 2:
        raise PalaceQuizValidationError("选择题至少需要 2 个选项。")
    if not correct_option_id:
        raise PalaceQuizValidationError("选择题必须指定正确选项。")
    if correct_option_id not in {item["id"] for item in options}:
        raise PalaceQuizValidationError("选择题正确选项必须出现在选项列表中。")
    return {"correct_option_id": correct_option_id}


def normalize_short_answer_payload(payload: dict[str, Any]) -> dict[str, Any]:
    reference_answer = str(payload.get("reference_answer") or "").strip()
    if not reference_answer:
        raise PalaceQuizValidationError("简答题必须填写参考答案。")
    return {"reference_answer": reference_answer}


def normalize_true_false_answer(payload: dict[str, Any]) -> dict[str, Any]:
    if "correct_answer" not in payload:
        raise PalaceQuizValidationError("判断题必须给出 correct_answer。")
    correct_answer = payload.get("correct_answer")
    if not isinstance(correct_answer, bool):
        raise PalaceQuizValidationError("判断题 correct_answer 必须是布尔值。")
    false_explanation = str(
        payload.get("false_explanation") or payload.get("error_explanation") or ""
    ).strip()
    return {
        "correct_answer": correct_answer,
        "false_explanation": false_explanation,
    }


def normalize_fill_blank_answer(payload: dict[str, Any]) -> dict[str, Any]:
    blanks_raw = payload.get("blanks")
    if not isinstance(blanks_raw, list) or len(blanks_raw) == 0:
        raise PalaceQuizValidationError("填空题必须提供 blanks。")
    if len(blanks_raw) > 3:
        raise PalaceQuizValidationError("填空题最多支持 3 个空。")
    blanks: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(blanks_raw):
        if not isinstance(item, dict):
            raise PalaceQuizValidationError("填空题 blanks 格式不正确。")
        blank_id = str(item.get("id") or f"blank_{index + 1}").strip()
        answer = str(item.get("answer") or "").strip()
        if not blank_id or blank_id in seen_ids or not answer:
            raise PalaceQuizValidationError("填空题每个空都必须有唯一 id 和答案。")
        aliases_raw = item.get("aliases")
        aliases = (
            [str(alias).strip() for alias in aliases_raw if str(alias).strip()]
            if isinstance(aliases_raw, list)
            else []
        )
        seen_ids.add(blank_id)
        blanks.append({"id": blank_id, "answer": answer, "aliases": aliases})
    return {"blanks": blanks}


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


def normalize_question_type(value: Any) -> str:
    normalized = str(value or "").strip()
    if normalized not in QUESTION_TYPES:
        raise PalaceQuizValidationError(
            "题型必须是 multiple_choice、short_answer、true_false、fill_blank、matching、ordering 或 categorization。"
        )
    return normalized


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


@dataclass(frozen=True, slots=True)
class NormalizedQuestionScope:
    mini_palace_id: int | None
    source_chapter_id: int | None
    classified_chapter_id: int | None
    origin_question_id: int | None


def resolve_question_scope(
    payload: dict[str, object],
    *,
    session: Session | None = None,
    palace_id: int | None = None,
    source_chapter_id: int | None = None,
) -> NormalizedQuestionScope:
    mini_palace_id = normalize_mini_palace_id(
        session,
        palace_id,
        payload.get("mini_palace_id"),
    )
    resolved_source_chapter_id = normalize_source_chapter_id(
        session,
        payload.get("source_chapter_id", source_chapter_id),
    )
    classified_chapter_id = normalize_classified_chapter_id(
        session,
        resolved_source_chapter_id,
        payload.get("classified_chapter_id"),
    )
    origin_question_id = normalize_origin_question_id(
        session,
        palace_id,
        payload.get("origin_question_id"),
    )
    if session is not None and palace_id is None and resolved_source_chapter_id is None:
        raise PalaceQuizValidationError("题目必须至少归属于一个宫殿或章节。")
    if resolved_source_chapter_id is not None and mini_palace_id is not None:
        raise PalaceQuizValidationError("章节题暂不支持绑定专项训练。")
    return NormalizedQuestionScope(
        mini_palace_id=mini_palace_id,
        source_chapter_id=resolved_source_chapter_id,
        classified_chapter_id=classified_chapter_id,
        origin_question_id=origin_question_id,
    )


def normalize_question_payload(
    payload: dict[str, object],
    *,
    default_source_meta: dict[str, object] | None = None,
    session: Session | None = None,
    palace_id: int | None = None,
    source_chapter_id: int | None = None,
) -> dict[str, object]:
    content = normalize_question_content(
        payload,
        default_source_meta=default_source_meta,
    )
    scope = resolve_question_scope(
        payload,
        session=session,
        palace_id=palace_id,
        source_chapter_id=source_chapter_id,
    )
    return {
        **content,
        "mini_palace_id": scope.mini_palace_id,
        "source_chapter_id": scope.source_chapter_id,
        "classified_chapter_id": scope.classified_chapter_id,
        "origin_question_id": scope.origin_question_id,
    }


__all__ = [
    "NormalizedQuestionScope",
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
    "build_question_answer_payload_input",
    "get_chapter_or_raise",
    "json_dump",
    "json_load",
    "normalize_answer_payload",
    "normalize_categorization_answer",
    "normalize_classified_chapter_id",
    "normalize_fill_blank_answer",
    "normalize_matching_answer",
    "normalize_mini_palace_id",
    "normalize_multiple_choice_answer",
    "normalize_optional_int",
    "normalize_options",
    "normalize_ordering_answer",
    "normalize_origin_question_id",
    "normalize_question_content",
    "normalize_question_payload",
    "normalize_question_type",
    "normalize_short_answer_payload",
    "normalize_source_chapter_id",
    "normalize_true_false_answer",
    "resolve_question_scope",
    "validate_mini_palace",
]
