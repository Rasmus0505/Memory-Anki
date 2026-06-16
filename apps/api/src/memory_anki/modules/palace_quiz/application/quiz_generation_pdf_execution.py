"""Core PDF quiz generation execution pipeline."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_generation_support import (
    PdfGenerationStepPlan,
    build_pdf_generation_step_plan,
)
from .quiz_generation_pdf_request import (
    PdfGenerationPreparedRequest,
    prepare_pdf_generation_request,
)
from .quiz_generation_shared import (
    ScenarioAiOptionsMap,
    normalize_pdf_sources_input,
    should_pair_pdf_generation_with_turbo,
    should_review_pdf_generation_with_turbo,
)


@dataclass(frozen=True, slots=True)
class PdfGenerationPreparedRun:
    prepared: PdfGenerationPreparedRequest
    should_pair_with_turbo: bool
    should_review_with_turbo: bool
    step_plan: PdfGenerationStepPlan


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_pdf_generation_run(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool,
    pdf_sources: list[dict[str, Any]] | None,
    selected_chapter_id: int | None,
    ai_options: AiRuntimeOptions | None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None,
) -> PdfGenerationPreparedRun:
    normalized_sources = normalize_pdf_sources_input(
        pdf_sources,
        legacy_subject_document_id=subject_document_id,
        legacy_page_selection=page_selection,
    )
    should_pair_with_turbo = should_pair_pdf_generation_with_turbo(
        {"pdf_sources": normalized_sources}
    )
    should_review_with_turbo = should_review_pdf_generation_with_turbo(
        enable_secondary_review
    )
    step_plan = build_pdf_generation_step_plan(
        should_pair_with_turbo=should_pair_with_turbo,
        should_review_with_turbo=should_review_with_turbo,
    )
    prepared = prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        normalized_sources=normalized_sources,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    return PdfGenerationPreparedRun(
        prepared=prepared,
        should_pair_with_turbo=should_pair_with_turbo,
        should_review_with_turbo=should_review_with_turbo,
        step_plan=step_plan,
    )


def execute_pdf_generation_initial_call(
    *,
    prepared_run: PdfGenerationPreparedRun,
    palace_id: int,
    stream: bool,
):
    prepared = prepared_run.prepared
    if stream:
        return _ai_service()._call_logged_chat_completion_stream(
            config=prepared.config,
            extra_payload=prepared.extra_payload,
            feature="宫殿做题",
            operation="palace_quiz_generate_pdf_stream",
            palace_id=palace_id,
            messages=prepared.messages,
            response_format={"type": "json_object"},
            request_payload=prepared.request_payload,
            image_items=prepared.image_items,
        )
    return _ai_service()._call_logged_chat_completion(
        config=prepared.config,
        extra_payload=prepared.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_pdf",
        palace_id=palace_id,
        messages=prepared.messages,
        response_format={"type": "json_object"},
        request_payload=prepared.request_payload,
        image_items=prepared.image_items,
    )


__all__ = [
    "PdfGenerationPreparedRun",
    "execute_pdf_generation_initial_call",
    "prepare_pdf_generation_run",
]
