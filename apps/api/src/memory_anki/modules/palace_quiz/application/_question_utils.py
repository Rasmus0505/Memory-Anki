"""Pure question payload extraction/normalization helpers shared across quiz services.

No AI calls, no patch targets — safe to share between the generation and
grouping service modules. These helpers operate on plain dicts/lists only
and are factored out of the original ``ai_service.py`` to reduce its size.
"""

from __future__ import annotations

import json
from typing import Any

from memory_anki.core.time import utc_now_naive
from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    extract_first_json_object,
)

from .service import (
    PalaceQuizValidationError,
    build_question_dedup_key,
    normalize_question_payload,
)


class PalaceQuizAiError(RuntimeError):
    """Raised when an AI call fails (protocol/HTTP/network/parse)."""


def build_generation_source_meta(
    *,
    source_kind: str,
    generation_mode: str,
    extra_prompt: str,
    subject_document_id: int | None = None,
    page_numbers: list[int] | None = None,
    image_names: list[str] | None = None,
    ai_call_log_id: str | None = None,
    pdf_sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "source_kind": source_kind,
        "subject_document_id": subject_document_id,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "extra_prompt": str(extra_prompt or "").strip(),
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "generation_mode": generation_mode,
        "pdf_sources": pdf_sources,
    }


def extract_questions_payload(response_text: str) -> list[dict[str, Any]]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError("AI 返回的做题 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError("AI 返回的做题结果不是对象。")
    questions = parsed.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    normalized_questions: list[dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            raise PalaceQuizAiError("AI 返回的题目列表格式不正确。")
        normalized_questions.append(item)
    return normalized_questions


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


def extract_mini_palace_grouping_payload(response_text: str) -> dict[str, Any]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError("AI 返回的小宫殿归类 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError("AI 返回的小宫殿归类结果不是对象。")
    groups = parsed.get("mini_palace_groups")
    unassigned = parsed.get("unassigned_question_indexes")
    if not isinstance(groups, list) or not isinstance(unassigned, list):
        raise PalaceQuizAiError("AI 返回的小宫殿归类结果缺少必需字段。")
    return parsed
