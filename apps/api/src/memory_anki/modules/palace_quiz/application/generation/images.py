"""Merged images quiz generation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .._question_utils import (
    build_generation_source_meta,
    finalize_generation_source_meta,
    normalize_generated_question_drafts,
)
from ..question_contracts import PalaceQuizValidationError
from .ocr_sources import build_uploaded_image_ocr_sources
from .shared import (
    apply_source_chapter_to_drafts,
    build_generation_messages,
    build_quiz_generation_preview_result,
    flatten_child_chapter_contexts,
    group_questions_for_preview_scope,
    resolve_selected_generation_chapter,
)


# === quiz_generation_image_request.py ===
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
    from .. import ai_service

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

# === quiz_generation_image_request_context.py ===
@dataclass(frozen=True, slots=True)
class ImageGenerationRequestContext:
    palace: Any
    selected_chapter: Any
    child_contexts: list[dict[str, Any]]


def load_image_generation_request_context(
    session: Session,
    *,
    palace_id: int,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
) -> ImageGenerationRequestContext:
    from ..questions.queries import get_palace_or_raise

    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
    child_contexts = (
        flatten_child_chapter_contexts(selected_chapter) if selected_chapter is not None else []
    )
    if selected_chapter is not None and classify_by_mini_palace and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
    return ImageGenerationRequestContext(
        palace=palace,
        selected_chapter=selected_chapter,
        child_contexts=child_contexts,
    )


__all__ = [
    "ImageGenerationRequestContext",
    "load_image_generation_request_context",
]

# === quiz_generation_image_request_payload.py ===
def build_image_generation_source_meta(
    *,
    context: ImageGenerationRequestContext,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
) -> dict[str, object]:
    image_names = [
        str(filename or f"image-{index + 1}.png")
        for index, (_content, filename) in enumerate(image_items)
    ]
    source_meta = build_generation_source_meta(
        source_kind="image_upload",
        generation_mode="single_image" if len(image_items) == 1 else "multi_image",
        extra_prompt=extra_prompt,
        image_names=image_names,
    )
    if context.selected_chapter is not None:
        source_meta["source_chapter_id"] = context.selected_chapter.id
    return source_meta


def build_image_generation_messages(
    *,
    session,
    extra_prompt: str,
    image_items: list[tuple[bytes, str | None]],
    prompt_override: str | None = None,
) -> tuple[list[dict[str, object]], str]:
    messages, system_prompt = build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label="图片识别",
        image_items=image_items,
        prompt_override=prompt_override,
    )
    return messages, system_prompt


__all__ = [
    "build_image_generation_messages",
    "build_image_generation_source_meta",
]

# === quiz_generation_image_preview.py ===
def build_image_generation_preview_result(
    session: Session,
    *,
    prepared_request: ImageGenerationPreparedRequest,
    palace_id: int,
    response_text: str,
    log_id: str,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    finalize_generation_source_meta(
        prepared_request.source_meta,
        ai_call_log_id=log_id,
    )
    ocr_sources = build_uploaded_image_ocr_sources(
        image_items=prepared_request.image_items,
        source_meta=prepared_request.source_meta,
    )
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=prepared_request.source_meta,
    )
    selected_chapter = prepared_request.selected_chapter
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    grouped_questions = None
    if classify_by_mini_palace:
        grouped_questions = group_questions_for_preview_scope(
            session,
            palace=prepared_request.palace,
            drafts=drafts,
            selected_chapter=selected_chapter,
            child_contexts=prepared_request.child_contexts,
            feature="宫殿做题",
            child_chapter_operation="palace_quiz_group_by_child_chapter",
            mini_palace_operation="ai_prompt_palace_quiz_group_by_mini_palace",
            ai_options=ai_options,
        )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=prepared_request.source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=grouped_questions,
        resolved_ai=prepared_request.resolved_ai,
        extra_fields={"ocr_sources": ocr_sources},
    )


__all__ = ["build_image_generation_preview_result"]

# === quiz_generation_images.py ===
def generate_quiz_preview_from_images(
    session: Session,
    *,
    palace_id: int,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_image_generation_request(
        session,
        palace_id=palace_id,
        image_items=image_items,
        extra_prompt=extra_prompt,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_images",
        palace_id=palace_id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
        image_items=prepared_request.image_items,
    )
    return build_image_generation_preview_result(
        session,
        prepared_request=prepared_request,
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
    )


__all__ = ["generate_quiz_preview_from_images"]
