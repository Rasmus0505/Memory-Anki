"""Shared runtime helpers for PDF quiz recovery flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import (
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .quiz_generation_chaptering import apply_source_chapter_to_drafts
from .quiz_generation_pdf_recovery_support import PdfRecoveryContext
from .quiz_generation_shared import recover_pdf_pairing_from_log


@dataclass(frozen=True, slots=True)
class PdfRecoveryDraftState:
    pairing_response_text: str
    pairing_resolved_ai: dict[str, Any]
    drafts: list[dict[str, Any]]
    warnings: list[str]
    generation_stats: dict[str, Any]


def recover_pdf_generation_pairing(
    session: Session,
    *,
    palace_id: int,
    context: PdfRecoveryContext,
    ai_options: AiRuntimeOptions | None,
) -> tuple[str, dict[str, Any]]:
    return recover_pdf_pairing_from_log(
        session,
        palace_id=palace_id,
        vision_draft_text=context.vision_draft_text,
        source_context=context.source_context,
        source_meta=context.recovered_source_meta,
        extra_prompt=str(context.source_meta.get("extra_prompt") or "").strip(),
        ai_options=ai_options,
    )


def build_pdf_recovery_draft_state(
    session: Session,
    *,
    palace_id: int,
    context: PdfRecoveryContext,
    ai_options: AiRuntimeOptions | None,
) -> PdfRecoveryDraftState:
    pairing_response_text, pairing_resolved_ai = recover_pdf_generation_pairing(
        session,
        palace_id=palace_id,
        context=context,
        ai_options=ai_options,
    )
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        pairing_response_text,
        source_meta=context.recovered_source_meta,
    )
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=context.selected_chapter.id if context.selected_chapter is not None else None,
    )
    return PdfRecoveryDraftState(
        pairing_response_text=pairing_response_text,
        pairing_resolved_ai=pairing_resolved_ai,
        drafts=drafts,
        warnings=warnings,
        generation_stats=generation_stats,
    )


__all__ = [
    "PdfRecoveryDraftState",
    "build_pdf_recovery_draft_state",
    "recover_pdf_generation_pairing",
]
