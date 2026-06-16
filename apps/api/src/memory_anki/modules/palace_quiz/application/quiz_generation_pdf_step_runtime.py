"""Runtime AI step execution for PDF-specific post-processing."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_step_request import (
    PdfGenerationStepPreparedRequest,
    prepare_pdf_pairing_request,
    prepare_pdf_review_request,
)


def _ai_service():
    from . import ai_service

    return ai_service


def _execute_pdf_step_request(
    *,
    prepared_request: PdfGenerationStepPreparedRequest,
    palace_id: int,
    operation: str,
) -> tuple[str, str, dict[str, Any]]:
    next_response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation=operation,
        palace_id=palace_id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    return next_response_text, log_id, prepared_request.resolved_ai


def pair_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, str, dict[str, Any]]:
    prepared_request = prepare_pdf_pairing_request(
        session,
        response_text=response_text,
        source_context=source_context,
        source_meta=source_meta,
        extra_prompt=extra_prompt,
        ai_options=ai_options,
    )
    return _execute_pdf_step_request(
        prepared_request=prepared_request,
        palace_id=palace_id,
        operation="palace_quiz_pair_pdf_with_turbo",
    )


def recover_pdf_pairing_from_log(
    session: Session,
    *,
    palace_id: int,
    vision_draft_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, dict[str, Any]]:
    response_text, _log_id, resolved_ai = pair_pdf_generation_with_turbo(
        session,
        palace_id=palace_id,
        response_text=vision_draft_text,
        source_context=source_context,
        source_meta=source_meta,
        extra_prompt=extra_prompt,
        ai_options=ai_options,
    )
    return response_text, resolved_ai


def review_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, str, dict[str, Any]]:
    prepared_request = prepare_pdf_review_request(
        session,
        response_text=response_text,
        source_meta=source_meta,
        extra_prompt=extra_prompt,
        ai_options=ai_options,
    )
    return _execute_pdf_step_request(
        prepared_request=prepared_request,
        palace_id=palace_id,
        operation="palace_quiz_review_pdf_with_turbo",
    )


__all__ = [
    "pair_pdf_generation_with_turbo",
    "recover_pdf_pairing_from_log",
    "review_pdf_generation_with_turbo",
]
