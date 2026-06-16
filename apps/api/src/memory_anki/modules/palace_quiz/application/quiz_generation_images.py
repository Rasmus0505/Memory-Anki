"""Image-based quiz generation facade."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_image_preview import build_image_generation_preview_result
from .quiz_generation_image_request import prepare_image_generation_request


def _ai_service():
    from . import ai_service

    return ai_service


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
