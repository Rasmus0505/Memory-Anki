"""Step implementations for PDF quiz generation completion flows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_completion_state import PdfGenerationExecutionState
from .quiz_generation_pdf_preview import build_pdf_generation_preview_result
from .quiz_generation_pdf_request import PdfGenerationPreparedRequest
from .quiz_generation_shared import (
    ScenarioAiOptionsMap,
    pair_pdf_generation_with_turbo,
    resolve_pdf_step_ai_options,
    review_pdf_generation_with_turbo,
)


def _build_next_completion_state(
    completion_state: PdfGenerationExecutionState,
    *,
    response_text: str,
    log_id: str,
    step_key: str,
    resolved_ai: dict[str, Any],
    vision_draft_text: str | None,
) -> PdfGenerationExecutionState:
    resolved_ai_steps = dict(completion_state.resolved_ai_steps)
    resolved_ai_steps[step_key] = resolved_ai
    return PdfGenerationExecutionState(
        response_text=response_text,
        log_id=log_id,
        resolved_ai_steps=resolved_ai_steps,
        vision_draft_text=vision_draft_text,
    )


def pair_pdf_generation_completion(
    session: Session,
    *,
    prepared: PdfGenerationPreparedRequest,
    completion_state: PdfGenerationExecutionState,
    palace_id: int,
    extra_prompt: str,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationExecutionState:
    response_text, log_id, pairing_resolved_ai = pair_pdf_generation_with_turbo(
        session,
        palace_id=palace_id,
        response_text=completion_state.response_text,
        source_context=prepared.source_context,
        source_meta=prepared.source_meta,
        extra_prompt=extra_prompt,
        ai_options=resolve_pdf_step_ai_options(
            scenario_key="quiz_pdf_pairing",
            ai_options_by_scenario=ai_options_by_scenario,
        ),
    )
    return _build_next_completion_state(
        completion_state,
        response_text=response_text,
        log_id=log_id,
        step_key="pairing",
        resolved_ai=pairing_resolved_ai,
        vision_draft_text=completion_state.response_text,
    )


def review_pdf_generation_completion(
    session: Session,
    *,
    prepared: PdfGenerationPreparedRequest,
    completion_state: PdfGenerationExecutionState,
    palace_id: int,
    extra_prompt: str,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationExecutionState:
    response_text, log_id, review_resolved_ai = review_pdf_generation_with_turbo(
        session,
        palace_id=palace_id,
        response_text=completion_state.response_text,
        source_meta=prepared.source_meta,
        extra_prompt=extra_prompt,
        ai_options=resolve_pdf_step_ai_options(
            scenario_key="quiz_pdf_review",
            ai_options_by_scenario=ai_options_by_scenario,
        ),
    )
    return _build_next_completion_state(
        completion_state,
        response_text=response_text,
        log_id=log_id,
        step_key="review",
        resolved_ai=review_resolved_ai,
        vision_draft_text=completion_state.vision_draft_text,
    )


def finalize_pdf_generation_completion(
    session: Session,
    *,
    prepared: PdfGenerationPreparedRequest,
    completion_state: PdfGenerationExecutionState,
    palace_id: int,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    return build_pdf_generation_preview_result(
        session,
        palace=prepared.palace,
        palace_id=palace_id,
        response_text=completion_state.response_text,
        log_id=completion_state.log_id,
        source_meta=prepared.source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=prepared.selected_chapter,
        ai_options=ai_options,
        resolved_ai_steps=completion_state.resolved_ai_steps,
        vision_draft_text=completion_state.vision_draft_text,
    )


__all__ = [
    "finalize_pdf_generation_completion",
    "pair_pdf_generation_completion",
    "review_pdf_generation_completion",
]
