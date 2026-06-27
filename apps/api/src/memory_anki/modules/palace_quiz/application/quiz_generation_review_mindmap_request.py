"""Request preparation for review-mindmap quiz generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_review_mindmap_request_context import (
    load_review_mindmap_request_context,
)
from .quiz_generation_review_mindmap_request_payload import (
    build_review_mindmap_generation_messages,
    build_review_mindmap_generation_model_input,
    build_review_mindmap_generation_source_meta,
)


@dataclass(frozen=True, slots=True)
class ReviewMindmapPreparedRequest:
    palace: Any
    source_meta: dict[str, Any]
    related_summaries: list[dict[str, Any]]
    system_prompt: str
    model_input: dict[str, Any]
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_review_mindmap_generation_request(
    session: Session,
    *,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None,
    ai_options: AiRuntimeOptions | None,
) -> ReviewMindmapPreparedRequest:
    request_context = load_review_mindmap_request_context(
        session,
        palace_id=palace_id,
        mode=mode,
        question_types=question_types,
        question_count=question_count,
        review_editor_doc=review_editor_doc,
        related_palace_ids=related_palace_ids,
    )
    source_meta = build_review_mindmap_generation_source_meta(request_context)
    model_input = build_review_mindmap_generation_model_input(request_context)
    system_prompt, messages = build_review_mindmap_generation_messages(
        model_input,
        prompt_override=ai_options.prompt_override if ai_options else None,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_review_mindmap_generation",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    return ReviewMindmapPreparedRequest(
        palace=request_context.palace,
        source_meta=source_meta,
        related_summaries=request_context.related_summaries,
        system_prompt=system_prompt,
        model_input=model_input,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "source_meta": source_meta,
            "resolved_ai": resolved_ai,
        },
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
    )


__all__ = [
    "ReviewMindmapPreparedRequest",
    "prepare_review_mindmap_generation_request",
]
