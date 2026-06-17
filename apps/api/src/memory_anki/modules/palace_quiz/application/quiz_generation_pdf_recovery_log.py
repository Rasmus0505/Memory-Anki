"""Log-input extraction for PDF recovery flows."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .question_contracts import PalaceQuizValidationError


@dataclass(frozen=True, slots=True)
class PdfRecoveryLogInputs:
    request_payload: dict[str, Any]
    source_meta: dict[str, Any]
    vision_draft_text: str
    source_context: str


def extract_pdf_recovery_log_inputs(log_payload: dict[str, Any]) -> PdfRecoveryLogInputs:
    request_payload = log_payload.get("request_payload") or {}
    if not isinstance(request_payload, dict):
        raise PalaceQuizValidationError("AI 日志内容不完整，无法恢复题目。")
    model_input = request_payload.get("messages")
    if not isinstance(model_input, list) or len(model_input) < 2:
        raise PalaceQuizValidationError("AI 日志里缺少可恢复的题答配对输入。")
    user_message = model_input[-1]
    vision_draft_text = ""
    source_context = ""
    if isinstance(user_message, dict):
        try:
            user_payload = json.loads(str(user_message.get("content") or "{}"))
        except json.JSONDecodeError as exc:
            raise PalaceQuizValidationError("AI 日志里的配对输入无法解析。") from exc
        vision_draft_text = str(user_payload.get("vision_draft") or "").strip()
        source_context = str(user_payload.get("source_context") or "").strip()
    if not vision_draft_text or not source_context:
        raise PalaceQuizValidationError("AI 日志里缺少候选题或来源说明，无法恢复题目。")
    source_meta = (
        request_payload.get("source_meta")
        if isinstance(request_payload.get("source_meta"), dict)
        else {}
    )
    return PdfRecoveryLogInputs(
        request_payload=request_payload,
        source_meta=source_meta,
        vision_draft_text=vision_draft_text,
        source_context=source_context,
    )


__all__ = [
    "extract_pdf_recovery_log_inputs",
    "PdfRecoveryLogInputs",
]
