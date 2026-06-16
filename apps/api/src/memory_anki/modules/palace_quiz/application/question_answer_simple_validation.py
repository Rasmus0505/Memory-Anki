from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError


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


__all__ = [
    "normalize_fill_blank_answer",
    "normalize_multiple_choice_answer",
    "normalize_short_answer_payload",
    "normalize_true_false_answer",
]
