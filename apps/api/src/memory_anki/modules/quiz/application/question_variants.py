"""AI question variants stored on the question row.

The question row is the immutable original: ``stem``, ``options_json``,
``answer_payload_json`` and ``analysis`` are never replaced by a variant.
``variant_history_json`` keeps the AI rewrites, and ``active_variant_id``
selects which content the practice surfaces display. This keeps "restore the
original" a single pointer write and avoids two competing copies of the
original content.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from memory_anki.modules.quiz.application.question_contracts import (
    QUESTION_TYPE_CATEGORIZATION,
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPE_TRUE_FALSE,
    QUESTION_TYPES,
    json_load,
)

ACTIVE_VERSION_ORIGINAL = "original"
AI_VARIANT_TAG = "【AI变体】"
_VARIANT_ID_PATTERN = re.compile(r"^v(\d+)$")
_SOURCE_TAG_PATTERN = re.compile(r"^(【[^】]+】)")
_OPTION_PREFIX_PATTERN = re.compile(r"^([A-Za-z])[.、．:：)）]\s*(.*)$")


class QuestionVariantError(ValueError):
    """A single import item is not a valid variant; the batch keeps going."""

    def __init__(self, message: str, *, code: str = "invalid") -> None:
        super().__init__(message)
        self.code = code


def json_variants(question: Any) -> list[dict[str, Any]]:
    raw = json_load(getattr(question, "variant_history_json", "[]"), [])
    if not isinstance(raw, list):
        return []
    variants: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        version_id = str(item.get("version_id") or "").strip()
        if not version_id or version_id == ACTIVE_VERSION_ORIGINAL:
            continue
        variants.append(item)
    return variants


def resolved_active_version_id(question: Any) -> str:
    active = str(getattr(question, "active_variant_id", ACTIVE_VERSION_ORIGINAL) or "")
    active = active.strip() or ACTIVE_VERSION_ORIGINAL
    if active == ACTIVE_VERSION_ORIGINAL:
        return ACTIVE_VERSION_ORIGINAL
    return active if any(v.get("version_id") == active for v in json_variants(question)) else ACTIVE_VERSION_ORIGINAL


def original_content(question: Any) -> dict[str, Any]:
    return {
        "question_type": str(getattr(question, "question_type", "") or ""),
        "stem": str(getattr(question, "stem", "") or ""),
        "options": json_load(getattr(question, "options_json", "[]"), []),
        "answer_payload": json_load(getattr(question, "answer_payload_json", "{}"), {}),
        "analysis": str(getattr(question, "analysis", "") or ""),
    }


def _variant_content(variant: dict[str, Any]) -> dict[str, Any]:
    return {
        "question_type": str(variant.get("question_type") or ""),
        "stem": str(variant.get("stem") or ""),
        "options": variant.get("options") if isinstance(variant.get("options"), list) else [],
        "answer_payload": variant.get("answer_payload")
        if isinstance(variant.get("answer_payload"), dict)
        else {},
        "analysis": str(variant.get("analysis") or ""),
    }


def effective_content(question: Any) -> dict[str, Any]:
    active = resolved_active_version_id(question)
    if active != ACTIVE_VERSION_ORIGINAL:
        for variant in json_variants(question):
            if str(variant.get("version_id")) == active:
                return _variant_content(variant)
    return original_content(question)


def serialize_variant(variant: dict[str, Any]) -> dict[str, Any]:
    return {
        "version_id": str(variant.get("version_id") or ""),
        "created_at": variant.get("created_at"),
        "question_type": str(variant.get("question_type") or ""),
        "stem": str(variant.get("stem") or ""),
        "options": variant.get("options") if isinstance(variant.get("options"), list) else [],
        "answer_payload": variant.get("answer_payload")
        if isinstance(variant.get("answer_payload"), dict)
        else {},
        "analysis": str(variant.get("analysis") or ""),
        "base_version_id": str(variant.get("base_version_id") or ACTIVE_VERSION_ORIGINAL),
        "source": str(variant.get("source") or "external_ai"),
    }


def serialize_versions_payload(question: Any) -> dict[str, Any]:
    active = resolved_active_version_id(question)
    original = original_content(question)
    variants = [
        serialize_variant(variant)
        for variant in reversed(json_variants(question))
    ]
    return {
        "question_id": int(question.id),
        "active_version_id": active,
        "needs_mutation": bool(getattr(question, "needs_mutation", False)),
        "original": {
            **original,
            "version_id": ACTIVE_VERSION_ORIGINAL,
            "created_at": question.created_at.isoformat() if getattr(question, "created_at", None) else None,
        },
        "versions": variants,
        "mutation_attempt_count": int(getattr(question, "mutation_attempt_count", 0) or 0),
        "consecutive_correct_count": int(
            getattr(question, "consecutive_correct_count", 0) or 0
        ),
        "last_answer_duration_ms": getattr(question, "last_answer_duration_ms", None),
        "variant_activated_at": (
            question.variant_activated_at.isoformat()
            if getattr(question, "variant_activated_at", None)
            else None
        ),
    }


def next_version_id(variants: list[dict[str, Any]]) -> str:
    highest = 0
    for variant in variants:
        match = _VARIANT_ID_PATTERN.match(str(variant.get("version_id") or ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return f"v{highest + 1}"


def normalize_variant_stem(stem: str) -> str:
    text = str(stem or "").strip()
    if not text:
        raise QuestionVariantError("变体题干不能为空。")
    if AI_VARIANT_TAG in text:
        return text
    tag_match = _SOURCE_TAG_PATTERN.match(text)
    if tag_match:
        tag = tag_match.group(1)
        return f"{tag}{AI_VARIANT_TAG}{text[len(tag):].lstrip()}"
    return f"{AI_VARIANT_TAG}{text}"


def _strip_option_prefix(text: str) -> tuple[str, str]:
    value = str(text or "").strip()
    match = _OPTION_PREFIX_PATTERN.match(value)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return "", value


def _normalize_options(raw: Any, question_type: str) -> list[dict[str, str]]:
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise QuestionVariantError("options 必须是数组。")
    options: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        inferred_id = ""
        if isinstance(item, dict):
            option_id = str(item.get("id") or item.get("key") or "").strip().upper()
            text = str(item.get("text") or item.get("label") or "").strip()
        elif isinstance(item, str):
            inferred_id, text = _strip_option_prefix(item)
            option_id = inferred_id
        else:
            raise QuestionVariantError("options 的每一项必须是对象或字符串。")
        if not option_id:
            option_id = chr(ord("A") + index)
        if not text:
            raise QuestionVariantError(f"选项 {option_id} 缺少内容。")
        if option_id in seen:
            raise QuestionVariantError(f"选项 {option_id} 重复。")
        seen.add(option_id)
        options.append({"id": option_id, "text": text})
    if question_type == QUESTION_TYPE_MULTIPLE_CHOICE and len(options) < 2:
        raise QuestionVariantError("选择题至少需要两个选项。")
    return options


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "对", "正确", "yes"}:
            return True
        if normalized in {"false", "0", "错", "错误", "no"}:
            return False
    return None


def _original_is_multi_choice(question: Any) -> bool:
    payload = json_load(getattr(question, "answer_payload_json", "{}"), {})
    if not isinstance(payload, dict):
        return False
    ids = payload.get("correct_option_ids")
    return isinstance(ids, list) and len(ids) > 0


def _normalize_choice_answer(
    payload: dict[str, Any],
    *,
    options: list[dict[str, str]],
    original_is_multi: bool,
    fallback: Any,
) -> dict[str, Any]:
    option_ids = {option["id"] for option in options}
    raw_ids = payload.get("correct_option_ids")
    raw_id = payload.get("correct_option_id")
    if raw_ids is None and fallback is not None:
        raw_ids = fallback if isinstance(fallback, list) else None
        raw_id = fallback if isinstance(fallback, str) else raw_id
    if original_is_multi:
        if raw_ids is None and isinstance(raw_id, str):
            raw_ids = [raw_id]
        if not isinstance(raw_ids, list) or not raw_ids:
            raise QuestionVariantError("原题是多选题，变体必须提供 correct_option_ids。")
        correct_ids = [str(item).strip().upper() for item in raw_ids if str(item).strip()]
        if not correct_ids:
            raise QuestionVariantError("多选题答案不能为空。")
        missing = [item for item in correct_ids if item not in option_ids]
        if missing:
            raise QuestionVariantError(f"正确答案 {missing[0]} 不在选项中。")
        return {"correct_option_ids": sorted(set(correct_ids))}
    if isinstance(raw_ids, list):
        if len(raw_ids) != 1:
            raise QuestionVariantError("原题是单选题，变体只能保留一个正确答案。")
        raw_id = raw_ids[0]
    if not isinstance(raw_id, str) or not raw_id.strip():
        raise QuestionVariantError("缺少 correct_option_id。")
    correct_id = raw_id.strip().upper()
    if correct_id not in option_ids:
        raise QuestionVariantError(f"正确答案 {correct_id} 不在选项中。")
    return {"correct_option_id": correct_id}


def _normalize_answer_payload(
    raw_payload: Any,
    *,
    question_type: str,
    options: list[dict[str, str]],
    original_is_multi: bool,
    fallback: Any,
) -> dict[str, Any]:
    payload = copy.deepcopy(raw_payload) if isinstance(raw_payload, dict) else {}
    if not payload and fallback is not None:
        if question_type == QUESTION_TYPE_SHORT_ANSWER and isinstance(fallback, str):
            payload = {"reference_answer": fallback}
        elif question_type == QUESTION_TYPE_TRUE_FALSE:
            value = _as_bool(fallback)
            if value is not None:
                payload = {"correct_answer": value}
        elif question_type == QUESTION_TYPE_MULTIPLE_CHOICE:
            payload = {}
    if question_type == QUESTION_TYPE_MULTIPLE_CHOICE:
        return _normalize_choice_answer(
            payload,
            options=options,
            original_is_multi=original_is_multi,
            fallback=fallback,
        )
    if question_type == QUESTION_TYPE_SHORT_ANSWER:
        reference = str(payload.get("reference_answer") or "").strip()
        if not reference:
            raise QuestionVariantError("简答题必须提供 reference_answer。")
        return {**payload, "reference_answer": reference}
    if question_type == QUESTION_TYPE_TRUE_FALSE:
        value = _as_bool(payload.get("correct_answer"))
        if value is None:
            raise QuestionVariantError("判断题必须提供 correct_answer（true/false）。")
        return {**payload, "correct_answer": value}
    if question_type == QUESTION_TYPE_FILL_BLANK:
        blanks = payload.get("blanks")
        if not isinstance(blanks, list) or not blanks:
            raise QuestionVariantError("填空题必须提供 blanks 数组。")
        normalized_blanks: list[dict[str, Any]] = []
        for index, blank in enumerate(blanks):
            if not isinstance(blank, dict):
                raise QuestionVariantError("blank 必须是对象。")
            blank_id = str(blank.get("id") or f"B{index + 1}").strip()
            answer = str(blank.get("answer") or "").strip()
            if not answer:
                raise QuestionVariantError(f"空 {blank_id} 缺少答案。")
            item: dict[str, Any] = {"id": blank_id, "answer": answer}
            aliases = blank.get("aliases")
            if isinstance(aliases, list):
                item["aliases"] = [str(alias) for alias in aliases if str(alias).strip()]
            normalized_blanks.append(item)
        return {**payload, "blanks": normalized_blanks}
    if question_type == QUESTION_TYPE_MATCHING:
        pairs = payload.get("pairs")
        if not isinstance(pairs, list) or len(pairs) < 2:
            raise QuestionVariantError("连线题至少需要两组 pairs。")
        normalized_pairs: list[dict[str, str]] = []
        for pair in pairs:
            if not isinstance(pair, dict):
                raise QuestionVariantError("pair 必须是对象。")
            normalized_pairs.append(
                {
                    "left_id": str(pair.get("left_id") or "").strip(),
                    "left": str(pair.get("left") or "").strip(),
                    "right_id": str(pair.get("right_id") or "").strip(),
                    "right": str(pair.get("right") or "").strip(),
                }
            )
        if any(not pair["left_id"] or not pair["right_id"] for pair in normalized_pairs):
            raise QuestionVariantError("连线题的 left_id / right_id 不能为空。")
        return {**payload, "pairs": normalized_pairs}
    if question_type == QUESTION_TYPE_ORDERING:
        items = payload.get("items")
        order = payload.get("correct_order_ids")
        if not isinstance(items, list) or len(items) < 2:
            raise QuestionVariantError("排序题至少需要两个 items。")
        if not isinstance(order, list) or not order:
            raise QuestionVariantError("排序题必须提供 correct_order_ids。")
        item_ids = [str(item.get("id") or "").strip() for item in items if isinstance(item, dict)]
        if any(not item_id for item_id in item_ids):
            raise QuestionVariantError("排序题 items 的 id 不能为空。")
        if set(order) != set(item_ids):
            raise QuestionVariantError("correct_order_ids 必须覆盖全部 items。")
        return {**payload, "items": items, "correct_order_ids": order}
    if question_type == QUESTION_TYPE_CATEGORIZATION:
        categories = payload.get("categories")
        items = payload.get("items")
        if not isinstance(categories, list) or not categories:
            raise QuestionVariantError("归类题必须提供 categories。")
        if not isinstance(items, list) or not items:
            raise QuestionVariantError("归类题必须提供 items。")
        category_ids = {
            str(category.get("id") or "").strip()
            for category in categories
            if isinstance(category, dict)
        }
        for item in items:
            if not isinstance(item, dict):
                raise QuestionVariantError("归类题的 item 必须是对象。")
            if str(item.get("category_id") or "").strip() not in category_ids:
                raise QuestionVariantError("归类题的 item.category_id 不在 categories 中。")
        return {**payload, "categories": categories, "items": items}
    raise QuestionVariantError(f"不支持的题型：{question_type}")


def _coerce_question_type(raw: Any, fallback: str) -> str:
    text = str(raw or "").strip().lower()
    aliases = {
        "choice": QUESTION_TYPE_MULTIPLE_CHOICE,
        "single_choice": QUESTION_TYPE_MULTIPLE_CHOICE,
        "multiple_choice": QUESTION_TYPE_MULTIPLE_CHOICE,
        "qa": QUESTION_TYPE_SHORT_ANSWER,
        "short": QUESTION_TYPE_SHORT_ANSWER,
        "short_answer": QUESTION_TYPE_SHORT_ANSWER,
        "judge": QUESTION_TYPE_TRUE_FALSE,
        "true_false": QUESTION_TYPE_TRUE_FALSE,
        "fill_blank": QUESTION_TYPE_FILL_BLANK,
        "matching": QUESTION_TYPE_MATCHING,
        "ordering": QUESTION_TYPE_ORDERING,
        "categorization": QUESTION_TYPE_CATEGORIZATION,
    }
    if not text:
        return fallback
    return aliases.get(text, text)


def normalize_import_item(
    raw: dict[str, Any],
    question: Any,
    *,
    active_version_id: str,
) -> dict[str, Any]:
    """Validate one external-AI item and return the stored variant content."""
    if not isinstance(raw, dict):
        raise QuestionVariantError("每道题必须是一个对象。")
    raw_id = raw.get("question_id", raw.get("id"))
    if raw_id is None:
        raise QuestionVariantError("question_id 不合法。")
    try:
        question_id = int(raw_id)
    except (TypeError, ValueError) as exc:
        raise QuestionVariantError("question_id 不合法。") from exc
    if question_id != int(question.id):
        raise QuestionVariantError("question_id 与当前题目不一致。")

    raw_base = raw.get("base_version_id", raw.get("baseVersionId"))
    if raw_base is not None:
        base = str(raw_base).strip() or ACTIVE_VERSION_ORIGINAL
        if base != active_version_id:
            raise QuestionVariantError(
                "题目版本已变化，请重新复制 Prompt 后再导入。",
                code="stale_base",
            )

    question_type = _coerce_question_type(
        raw.get("question_type", raw.get("type")), str(question.question_type or "")
    )
    if question_type not in QUESTION_TYPES:
        raise QuestionVariantError(f"不支持的题型：{question_type}")
    if question_type != str(question.question_type or ""):
        raise QuestionVariantError("变体题型必须与原题保持一致。")

    stem = normalize_variant_stem(str(raw.get("stem") or ""))
    analysis = str(raw.get("analysis") or "").strip()
    if not analysis:
        raise QuestionVariantError("变体解析不能为空。")

    options = _normalize_options(raw.get("options"), question_type)
    fallback = raw.get("answer", raw.get("correct"))
    answer_payload = _normalize_answer_payload(
        raw.get("answer_payload"),
        question_type=question_type,
        options=options,
        original_is_multi=_original_is_multi_choice(question),
        fallback=fallback,
    )
    return {
        "question_type": question_type,
        "stem": stem,
        "options": options,
        "answer_payload": answer_payload,
        "analysis": analysis,
        "base_version_id": active_version_id,
        "source": "external_ai",
    }


__all__ = [
    "ACTIVE_VERSION_ORIGINAL",
    "AI_VARIANT_TAG",
    "QuestionVariantError",
    "effective_content",
    "json_variants",
    "next_version_id",
    "normalize_import_item",
    "normalize_variant_stem",
    "original_content",
    "resolved_active_version_id",
    "serialize_variant",
    "serialize_versions_payload",
]
