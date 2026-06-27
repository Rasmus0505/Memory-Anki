"""Text-file quiz generation request preparation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_image_request_context import load_image_generation_request_context
from .quiz_generation_text_request_payload import (
    build_text_generation_messages,
    build_text_generation_source_meta,
)


@dataclass(frozen=True, slots=True)
class TextGenerationPreparedRequest:
    palace: Any
    selected_chapter: Any
    child_contexts: list[dict[str, Any]]
    config: Any
    extra_payload: dict[str, Any]
    source_meta: dict[str, Any]
    system_prompt: str
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    file_artifacts: list[dict[str, Any]]
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_text_generation_request(
    session: Session,
    *,
    palace_id: int,
    file_artifacts: list[dict[str, Any]],
    extra_prompt: str,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
    ai_options: AiRuntimeOptions | None,
) -> TextGenerationPreparedRequest:
    request_context = load_image_generation_request_context(
        session,
        palace_id=palace_id,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
    )
    ai = _ai_service()
    config, extra_payload, resolved_ai = ai._build_chat_config(
        session,
        scenario_key="quiz_text_generation",
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=120,
    )
    source_meta = build_text_generation_source_meta(
        context=request_context,
        file_artifacts=file_artifacts,
        extra_prompt=extra_prompt,
    )
    messages, system_prompt, model_input = build_text_generation_messages(
        extra_prompt=extra_prompt,
        file_artifacts=file_artifacts,
        prompt_override=ai_options.prompt_override if ai_options else None,
    )
    return TextGenerationPreparedRequest(
        palace=request_context.palace,
        selected_chapter=request_context.selected_chapter,
        child_contexts=request_context.child_contexts,
        config=config,
        extra_payload=extra_payload,
        source_meta=source_meta,
        system_prompt=system_prompt,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "message_roles": [message.get("role") for message in messages],
            "response_format": {"type": "json_object"},
            "source_meta": source_meta,
            "resolved_ai": resolved_ai,
            "input_artifacts": model_input,
        },
        file_artifacts=file_artifacts,
        resolved_ai=resolved_ai,
    )


__all__ = [
    "TextGenerationPreparedRequest",
    "prepare_text_generation_request",
]
