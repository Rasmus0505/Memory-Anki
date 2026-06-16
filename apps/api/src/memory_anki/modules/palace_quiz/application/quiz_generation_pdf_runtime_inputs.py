"""Runtime input preparation for PDF quiz generation flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_completion import (
    build_pdf_generation_completion_context,
    PdfGenerationCompletionContext,
)
from .quiz_generation_pdf_execution import (
    prepare_pdf_generation_run,
    PdfGenerationPreparedRun,
)
from .quiz_generation_shared import ScenarioAiOptionsMap


@dataclass(frozen=True, slots=True)
class PdfGenerationRuntimeInputs:
    prepared_run: PdfGenerationPreparedRun
    completion_context: PdfGenerationCompletionContext


def build_pdf_generation_runtime_completion_context(
    *,
    prepared_run: PdfGenerationPreparedRun,
    palace_id: int,
    extra_prompt: str,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationCompletionContext:
    return build_pdf_generation_completion_context(
        prepared=prepared_run.prepared,
        should_pair_with_turbo=prepared_run.should_pair_with_turbo,
        should_review_with_turbo=prepared_run.should_review_with_turbo,
        palace_id=palace_id,
        extra_prompt=extra_prompt,
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )


def prepare_pdf_generation_runtime_inputs(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool,
    pdf_sources: list[dict[str, Any]] | None,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
    ai_options: AiRuntimeOptions | None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationRuntimeInputs:
    prepared_run = prepare_pdf_generation_run(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        pdf_sources=pdf_sources,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    completion_context = build_pdf_generation_runtime_completion_context(
        prepared_run=prepared_run,
        palace_id=palace_id,
        extra_prompt=extra_prompt,
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    return PdfGenerationRuntimeInputs(
        prepared_run=prepared_run,
        completion_context=completion_context,
    )


__all__ = [
    "PdfGenerationRuntimeInputs",
    "build_pdf_generation_runtime_completion_context",
    "prepare_pdf_generation_runtime_inputs",
]
