from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError
from .question_dedup import build_question_dedup_key
from .question_generation_errors import PalaceQuizAiError
from .question_generation_payloads import extract_questions_payload
from .question_validation import normalize_question_payload


def normalize_generated_question_drafts(
    response_text: str,
    *,
    source_meta: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], dict[str, int]]:
    raw_questions = extract_questions_payload(response_text)
    drafts: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_dedup_keys: set[str] = set()
    for index, item in enumerate(raw_questions, start=1):
        try:
            normalized = normalize_question_payload(
                item,
                default_source_meta=source_meta,
            )
        except PalaceQuizValidationError as exc:
            reason = str(exc)
            if "每个选项都必须填写内容" in reason:
                reason = "选项格式不完整"
            elif "正确选项必须出现在选项列表中" in reason:
                reason = "正确答案不在选项列表中"
            warnings.append(f"第 {index} 题{reason}，已跳过；请重试或补充提示词要求选项完整。")
            continue
        dedup_key = build_question_dedup_key(normalized)
        if dedup_key in seen_dedup_keys:
            warnings.append(f"第 {index} 题与前面题目重复，已自动去重。")
            continue
        seen_dedup_keys.add(dedup_key)
        drafts.append({**normalized, "source_meta": source_meta})
    stats = {
        "returned_count": len(raw_questions),
        "savable_count": len(drafts),
        "skipped_count": len(raw_questions) - len(drafts),
    }
    if len(drafts) == 0:
        if warnings:
            raise PalaceQuizAiError("AI 返回的题目全部无法使用：" + "；".join(warnings))
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    return drafts, warnings, stats


__all__ = ["normalize_generated_question_drafts"]
