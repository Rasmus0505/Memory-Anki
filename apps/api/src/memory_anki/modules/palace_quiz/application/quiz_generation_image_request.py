"""Image quiz generation request preparation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_image_request_context import (
    load_image_generation_request_context,
)
from .quiz_generation_image_request_payload import (
    build_image_generation_messages,
    build_image_generation_source_meta,
)
from .question_contracts import PalaceQuizValidationError


@dataclass(frozen=True, slots=True)
class ImageGenerationPreparedRequest:
    palace: Any
    selected_chapter: Any
    child_contexts: list[dict[str, Any]]
    config: Any
    extra_payload: dict[str, Any]
    source_meta: dict[str, Any]
    system_prompt: str
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    image_items: list[tuple[bytes, str | None]]
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_image_generation_request(
    session: Session,
    *,
    palace_id: int,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
    ai_options: AiRuntimeOptions | None,
) -> ImageGenerationPreparedRequest:
    if len(image_items) == 0:
        raise PalaceQuizValidationError("请至少上传一张图片。")
    request_context = load_image_generation_request_context(
        session,
        palace_id=palace_id,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
    )
    ai = _ai_service()
    config, extra_payload, resolved_ai = ai._build_chat_config(
        session,
        scenario_key="quiz_image_generation",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    source_meta = build_image_generation_source_meta(
        context=request_context,
        image_items=image_items,
        extra_prompt=extra_prompt,
    )
    messages, system_prompt = build_image_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        image_items=image_items,
        prompt_override=ai_options.prompt_override if ai_options else None,
    )
    return ImageGenerationPreparedRequest(
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
        },
        image_items=image_items,
        resolved_ai=resolved_ai,
    )


__all__ = [
    "ImageGenerationPreparedRequest",
    "prepare_image_generation_request",
]
