"""State models for PDF quiz generation completion flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_request import PdfGenerationPreparedRequest
from .quiz_generation_shared import ScenarioAiOptionsMap


@dataclass(frozen=True, slots=True)
class PdfGenerationCompletionContext:
    prepared: PdfGenerationPreparedRequest
    should_pair_with_turbo: bool
    should_review_with_turbo: bool
    palace_id: int
    extra_prompt: str
    classify_by_mini_palace: bool
    ai_options: AiRuntimeOptions | None
    ai_options_by_scenario: ScenarioAiOptionsMap | None


@dataclass(frozen=True, slots=True)
class PdfGenerationExecutionState:
    response_text: str
    log_id: str
    resolved_ai_steps: dict[str, Any]
    vision_draft_text: str | None


@dataclass(frozen=True, slots=True)
class PdfGenerationCompletionEvent:
    phase: str
    completion_state: PdfGenerationExecutionState
    status_phase: str | None = None
    status_message: str | None = None
    result: dict[str, Any] | None = None


def build_pdf_generation_completion_context(
    *,
    prepared: PdfGenerationPreparedRequest,
    should_pair_with_turbo: bool,
    should_review_with_turbo: bool,
    palace_id: int,
    extra_prompt: str,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationCompletionContext:
    return PdfGenerationCompletionContext(
        prepared=prepared,
        should_pair_with_turbo=should_pair_with_turbo,
        should_review_with_turbo=should_review_with_turbo,
        palace_id=palace_id,
        extra_prompt=extra_prompt,
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )


def start_pdf_generation_completion(
    prepared: PdfGenerationPreparedRequest,
    *,
    response_text: str,
    log_id: str,
) -> PdfGenerationExecutionState:
    return PdfGenerationExecutionState(
        response_text=response_text,
        log_id=log_id,
        resolved_ai_steps=dict(prepared.resolved_ai_steps),
        vision_draft_text=None,
    )


__all__ = [
    "build_pdf_generation_completion_context",
    "PdfGenerationCompletionContext",
    "PdfGenerationCompletionEvent",
    "PdfGenerationExecutionState",
    "start_pdf_generation_completion",
]
