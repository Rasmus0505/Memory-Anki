"""Request preparation for PDF-specific post-processing AI steps."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_step_support import (
    build_pdf_pairing_prompt,
    build_pdf_review_prompt,
)


@dataclass(frozen=True, slots=True)
class PdfGenerationStepPreparedRequest:
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_pdf_pairing_request(
    session: Session,
    *,
    response_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> PdfGenerationStepPreparedRequest:
    system_prompt = (
        ai_options.prompt_override.strip()
        if ai_options and ai_options.prompt_override and ai_options.prompt_override.strip()
        else build_pdf_pairing_prompt(extra_prompt)
    )
    model_input = {
        "source_context": source_context,
        "vision_draft": response_text,
    }
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_pdf_pairing",
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=90,
    )
    return PdfGenerationStepPreparedRequest(
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "source_meta": source_meta,
            "resolved_ai": resolved_ai,
        },
    )


def prepare_pdf_review_request(
    session: Session,
    *,
    response_text: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> PdfGenerationStepPreparedRequest:
    system_prompt = (
        ai_options.prompt_override.strip()
        if ai_options and ai_options.prompt_override and ai_options.prompt_override.strip()
        else build_pdf_review_prompt(extra_prompt)
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": response_text},
    ]
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_pdf_review",
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=90,
    )
    return PdfGenerationStepPreparedRequest(
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "source_meta": source_meta,
            "resolved_ai": resolved_ai,
        },
    )


__all__ = [
    "PdfGenerationStepPreparedRequest",
    "prepare_pdf_pairing_request",
    "prepare_pdf_review_request",
]
