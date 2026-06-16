"""Projection helpers for PDF generation completion events."""

from __future__ import annotations

from dataclasses import dataclass

from .quiz_generation_pdf_completion_state import PdfGenerationCompletionEvent
from .quiz_generation_pdf_generation_support import (
    PdfGenerationStepPlan,
    resolve_pdf_generation_completion_step,
)


@dataclass(frozen=True, slots=True)
class PdfGenerationCompletionStatus:
    phase: str
    message: str
    step: int | None
    total: int


def project_pdf_generation_completion_status(
    *,
    event: PdfGenerationCompletionEvent,
    step_plan: PdfGenerationStepPlan,
) -> PdfGenerationCompletionStatus | None:
    if event.status_phase is None or event.status_message is None:
        return None
    return PdfGenerationCompletionStatus(
        phase=event.status_phase,
        message=event.status_message,
        step=resolve_pdf_generation_completion_step(
            step_plan=step_plan,
            phase=event.status_phase,
        ),
        total=step_plan.total_steps,
    )


__all__ = [
    "PdfGenerationCompletionStatus",
    "project_pdf_generation_completion_status",
]
