"""Support helpers for recovering PDF quiz generation from AI logs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.llm.external_ai_call_logs import get_external_ai_call_log

from .quiz_generation_chaptering import resolve_selected_generation_chapter
from .quiz_generation_pdf_recovery_log import extract_pdf_recovery_log_inputs
from .quiz_generation_pdf_recovery_source_meta import (
    build_recovered_source_meta,
    resolve_recovery_selected_chapter_id,
)
from .service import (
    PalaceQuizValidationError,
    get_palace_or_raise,
)


@dataclass(frozen=True, slots=True)
class PdfRecoveryContext:
    request_payload: dict[str, Any]
    vision_draft_text: str
    source_context: str
    source_meta: dict[str, Any]
    recovered_source_meta: dict[str, Any]
    palace: Any
    selected_chapter: Any


def load_pdf_recovery_context(
    session: Session,
    *,
    palace_id: int,
    ai_call_log_id: str,
    selected_chapter_id: int | None = None,
) -> PdfRecoveryContext:
    log_payload = get_external_ai_call_log(session, ai_call_log_id)
    if not log_payload:
        raise PalaceQuizValidationError("AI 日志不存在，无法恢复题目。")
    log_inputs = extract_pdf_recovery_log_inputs(log_payload)
    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=resolve_recovery_selected_chapter_id(
            log_inputs.source_meta,
            selected_chapter_id,
        ),
    )
    return PdfRecoveryContext(
        request_payload=log_inputs.request_payload,
        vision_draft_text=log_inputs.vision_draft_text,
        source_context=log_inputs.source_context,
        source_meta=log_inputs.source_meta,
        recovered_source_meta=build_recovered_source_meta(
            source_meta=log_inputs.source_meta,
            ai_call_log_id=ai_call_log_id,
            selected_chapter=selected_chapter,
        ),
        palace=palace,
        selected_chapter=selected_chapter,
    )


__all__ = [
    "PdfRecoveryContext",
    "build_recovered_source_meta",
    "load_pdf_recovery_context",
]
