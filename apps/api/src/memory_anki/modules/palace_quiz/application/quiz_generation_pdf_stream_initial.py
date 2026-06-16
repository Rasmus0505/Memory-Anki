"""Initial stream event helpers for PDF quiz generation."""

from __future__ import annotations

from collections.abc import Generator

from .quiz_generation_pdf_execution import (
    execute_pdf_generation_initial_call,
    PdfGenerationPreparedRun,
)
from .quiz_generation_pdf_generation_support import QuizStreamEvent


def build_pdf_generation_status_event(
    *,
    phase: str,
    message: str,
    step: int | None,
    total: int,
) -> QuizStreamEvent:
    return (
        "status",
        {
            "phase": phase,
            "message": message,
            "step": step,
            "total": total,
        },
    )


def emit_pdf_generation_start_statuses(
    *,
    prepared_run: PdfGenerationPreparedRun,
) -> Generator[QuizStreamEvent, None, None]:
    yield build_pdf_generation_status_event(
        phase="preparing",
        message="正在准备 PDF 页面",
        step=1,
        total=prepared_run.step_plan.total_steps,
    )
    yield build_pdf_generation_status_event(
        phase="generating",
        message="正在调用视觉模型识别题目",
        step=2,
        total=prepared_run.step_plan.total_steps,
    )


def stream_pdf_generation_initial_call(
    *,
    prepared_run: PdfGenerationPreparedRun,
    palace_id: int,
) -> Generator[QuizStreamEvent, None, tuple[str, str]]:
    stream = execute_pdf_generation_initial_call(
        prepared_run=prepared_run,
        palace_id=palace_id,
        stream=True,
    )
    while True:
        try:
            delta = next(stream)
        except StopIteration as exc:
            return exc.value
        yield ("delta", {"text": delta})


__all__ = [
    "build_pdf_generation_status_event",
    "emit_pdf_generation_start_statuses",
    "stream_pdf_generation_initial_call",
]
