"""Request preparation for chapter-outline quiz generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_chapter_outline_request_context import (
    load_chapter_outline_request_context,
)
from .quiz_generation_chapter_outline_request_payload import (
    build_chapter_outline_generation_messages,
    build_chapter_outline_generation_model_input,
    build_chapter_outline_generation_source_meta,
)
from memory_anki.infrastructure.db.models import Chapter


@dataclass(frozen=True, slots=True)
class ChapterOutlinePreparedRequest:
    chapter: Chapter
    child_contexts: list[dict[str, Any]]
    source_meta: dict[str, Any]
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


def prepare_chapter_outline_generation_request(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    extra_prompt: str,
    classify_by_child_chapter: bool,
    ai_options: AiRuntimeOptions | None,
) -> ChapterOutlinePreparedRequest:
    request_context = load_chapter_outline_request_context(
        session,
        chapter_id=chapter_id,
        question_types=question_types,
        question_count=question_count,
        classify_by_child_chapter=classify_by_child_chapter,
    )
    source_meta = build_chapter_outline_generation_source_meta(
        context=request_context,
        extra_prompt=extra_prompt,
        classify_by_child_chapter=classify_by_child_chapter,
    )
    model_input = build_chapter_outline_generation_model_input(request_context)
    system_prompt, messages = build_chapter_outline_generation_messages(
        session=session,
        model_input=model_input,
        extra_prompt=extra_prompt,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_image_generation",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    return ChapterOutlinePreparedRequest(
        chapter=request_context.chapter,
        child_contexts=request_context.child_contexts,
        source_meta=source_meta,
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
    "ChapterOutlinePreparedRequest",
    "prepare_chapter_outline_generation_request",
]
