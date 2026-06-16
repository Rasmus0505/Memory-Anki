"""Streaming PDF quiz generation runtime."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_runtime_inputs import (
    prepare_pdf_generation_runtime_inputs,
)
from .quiz_generation_pdf_stream_completion import (
    iter_pdf_generation_completion_stream_events,
)
from .quiz_generation_pdf_stream_initial import (
    emit_pdf_generation_start_statuses,
    stream_pdf_generation_initial_call,
)
from .quiz_generation_pdf_generation_support import QuizStreamEvent
from .quiz_generation_shared import ScenarioAiOptionsMap


def generate_quiz_preview_from_pdf_events(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool = False,
    pdf_sources: list[dict[str, Any]] | None = None,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
) -> Generator[QuizStreamEvent, None, None]:
    runtime_inputs = prepare_pdf_generation_runtime_inputs(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        pdf_sources=pdf_sources,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    prepared_run = runtime_inputs.prepared_run
    yield from emit_pdf_generation_start_statuses(prepared_run=prepared_run)
    response_text, log_id = yield from stream_pdf_generation_initial_call(
        prepared_run=prepared_run,
        palace_id=palace_id,
    )
    yield from iter_pdf_generation_completion_stream_events(
        session,
        completion_context=runtime_inputs.completion_context,
        prepared_run=prepared_run,
        response_text=response_text,
        log_id=log_id,
    )


__all__ = ["generate_quiz_preview_from_pdf_events"]
