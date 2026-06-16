"""Facade and orchestration for PDF quiz generation completion flows."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from .quiz_generation_pdf_completion_state import (
    build_pdf_generation_completion_context,
    PdfGenerationCompletionContext,
    PdfGenerationCompletionEvent,
    PdfGenerationExecutionState,
    start_pdf_generation_completion,
)
from .quiz_generation_pdf_completion_steps import (
    finalize_pdf_generation_completion,
    pair_pdf_generation_completion,
    review_pdf_generation_completion,
)


def _build_pdf_generation_completion_event(
    *,
    phase: str,
    completion_state: PdfGenerationExecutionState,
    status_phase: str | None = None,
    status_message: str | None = None,
    result: dict[str, Any] | None = None,
) -> PdfGenerationCompletionEvent:
    return PdfGenerationCompletionEvent(
        phase=phase,
        completion_state=completion_state,
        status_phase=status_phase,
        status_message=status_message,
        result=result,
    )


def iter_pdf_generation_completion_events(
    session: Session,
    *,
    context: PdfGenerationCompletionContext,
    response_text: str,
    log_id: str,
) -> Generator[PdfGenerationCompletionEvent, None, None]:
    completion_state = start_pdf_generation_completion(
        context.prepared,
        response_text=response_text,
        log_id=log_id,
    )
    if context.should_pair_with_turbo:
        completion_state = pair_pdf_generation_completion(
            session,
            prepared=context.prepared,
            completion_state=completion_state,
            palace_id=context.palace_id,
            extra_prompt=context.extra_prompt,
            ai_options_by_scenario=context.ai_options_by_scenario,
        )
        yield _build_pdf_generation_completion_event(
            phase="pairing",
            completion_state=completion_state,
            status_phase="pairing",
            status_message="正在用 Turbo 配对题目与答案",
        )
    if context.should_review_with_turbo:
        completion_state = review_pdf_generation_completion(
            session,
            prepared=context.prepared,
            completion_state=completion_state,
            palace_id=context.palace_id,
            extra_prompt=context.extra_prompt,
            ai_options_by_scenario=context.ai_options_by_scenario,
        )
        yield _build_pdf_generation_completion_event(
            phase="reviewing",
            completion_state=completion_state,
            status_phase="reviewing",
            status_message="正在复核题目范围",
        )
    result = finalize_pdf_generation_completion(
        session,
        prepared=context.prepared,
        completion_state=completion_state,
        palace_id=context.palace_id,
        classify_by_mini_palace=context.classify_by_mini_palace,
        ai_options=context.ai_options,
    )
    yield _build_pdf_generation_completion_event(
        phase="result",
        completion_state=completion_state,
        status_phase="normalizing",
        status_message="正在整理可保存题目",
        result=result,
    )


def run_pdf_generation_completion(
    session: Session,
    *,
    context: PdfGenerationCompletionContext,
    response_text: str,
    log_id: str,
) -> dict[str, Any]:
    return extract_pdf_generation_completion_result(
        iter_pdf_generation_completion_events(
            session,
            context=context,
            response_text=response_text,
            log_id=log_id,
        )
    )


def extract_pdf_generation_completion_result(
    events,
) -> dict[str, Any]:
    result: dict[str, Any] | None = None
    for event in events:
        if event.phase == "result":
            result = event.result
    if result is None:
        raise RuntimeError("PDF 题目完成态流程没有返回结果。")
    return result


__all__ = [
    "build_pdf_generation_completion_context",
    "PdfGenerationCompletionContext",
    "PdfGenerationCompletionEvent",
    "PdfGenerationExecutionState",
    "extract_pdf_generation_completion_result",
    "finalize_pdf_generation_completion",
    "iter_pdf_generation_completion_events",
    "pair_pdf_generation_completion",
    "run_pdf_generation_completion",
    "review_pdf_generation_completion",
    "start_pdf_generation_completion",
]
