"""PDF quiz generation request orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_pdf_request_context import (
    load_pdf_generation_request_context,
)
from .quiz_generation_pdf_request_payload import (
    build_pdf_generation_messages,
    build_pdf_generation_request_payload,
    build_pdf_generation_source_context,
    build_pdf_generation_source_meta,
)
from .quiz_generation_shared import (
    ScenarioAiOptionsMap,
    resolve_pdf_step_ai_options,
)


@dataclass(frozen=True, slots=True)
class PdfGenerationPreparedRequest:
    palace: Any
    selected_chapter: Any
    config: Any
    extra_payload: dict[str, Any] | None
    source_meta: dict[str, Any]
    source_context: str
    system_prompt: str
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    image_items: list[tuple[bytes, str | None]]
    resolved_ai: dict[str, Any]
    generation_ai_options: AiRuntimeOptions | None
    resolved_ai_steps: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_pdf_generation_request(
    session: Session,
    *,
    palace_id: int,
    normalized_sources: list[dict[str, object]],
    extra_prompt: str,
    enable_secondary_review: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
) -> PdfGenerationPreparedRequest:
    generation_ai_options = resolve_pdf_step_ai_options(
        scenario_key="quiz_pdf_generation",
        ai_options_by_scenario=ai_options_by_scenario,
        legacy_ai_options=ai_options,
        allow_legacy_fallback=True,
    )
    ai = _ai_service()
    config, extra_payload, resolved_ai = ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_generation",
        ai_options=generation_ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    request_context = load_pdf_generation_request_context(
        session,
        palace_id=palace_id,
        normalized_sources=normalized_sources,
        selected_chapter_id=selected_chapter_id,
        render_selected_pdf_pages=ai.render_selected_pdf_pages,
    )
    source_meta = build_pdf_generation_source_meta(
        context=request_context,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        resolved_ai=resolved_ai,
    )
    source_context = build_pdf_generation_source_context(request_context)
    messages, system_prompt = build_pdf_generation_messages(
        session=session,
        context=request_context,
        extra_prompt=extra_prompt,
        source_context=source_context,
        prompt_override=generation_ai_options.prompt_override if generation_ai_options else None,
    )
    request_payload = build_pdf_generation_request_payload(
        system_prompt=system_prompt,
        messages=messages,
        source_meta=source_meta,
        source_context=source_context,
        resolved_ai=resolved_ai,
    )
    return PdfGenerationPreparedRequest(
        palace=request_context.palace,
        selected_chapter=request_context.selected_chapter,
        config=config,
        extra_payload=extra_payload,
        source_meta=source_meta,
        source_context=source_context,
        system_prompt=system_prompt,
        messages=messages,
        request_payload=request_payload,
        image_items=request_context.source_artifacts.image_items,
        resolved_ai=resolved_ai,
        generation_ai_options=generation_ai_options,
        resolved_ai_steps={"generation": resolved_ai},
    )


__all__ = [
    "PdfGenerationPreparedRequest",
    "prepare_pdf_generation_request",
]
