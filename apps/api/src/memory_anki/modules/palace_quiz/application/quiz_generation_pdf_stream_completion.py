"""Completion-event streaming helpers for PDF quiz generation."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy.orm import Session

from .quiz_generation_pdf_completion import (
    extract_pdf_generation_completion_result,
    iter_pdf_generation_completion_events,
    PdfGenerationCompletionContext,
)
from .quiz_generation_pdf_completion_projection import (
    project_pdf_generation_completion_status,
)
from .quiz_generation_pdf_execution import PdfGenerationPreparedRun
from .quiz_generation_pdf_generation_support import QuizStreamEvent
from .quiz_generation_pdf_stream_initial import build_pdf_generation_status_event


def iter_pdf_generation_completion_stream_events(
    session: Session,
    *,
    completion_context: PdfGenerationCompletionContext,
    prepared_run: PdfGenerationPreparedRun,
    response_text: str,
    log_id: str,
) -> Generator[QuizStreamEvent, None, None]:
    completion_events = iter_pdf_generation_completion_events(
        session,
        context=completion_context,
        response_text=response_text,
        log_id=log_id,
    )
    for event in completion_events:
        projected_status = project_pdf_generation_completion_status(
            event=event,
            step_plan=prepared_run.step_plan,
        )
        if projected_status is not None:
            yield build_pdf_generation_status_event(
                phase=projected_status.phase,
                message=projected_status.message,
                step=projected_status.step,
                total=projected_status.total,
            )
        if event.phase == "result":
            yield ("result", extract_pdf_generation_completion_result([event]))
            return


__all__ = ["iter_pdf_generation_completion_stream_events"]
