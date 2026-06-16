"""Payload assembly for image-based quiz generation requests."""

from __future__ import annotations

from ._question_utils import build_generation_source_meta
from .quiz_generation_image_request_context import ImageGenerationRequestContext
from .quiz_generation_shared import build_generation_messages


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
) -> tuple[list[dict[str, object]], str]:
    messages, system_prompt = build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label="图片识别",
        image_items=image_items,
    )
    return messages, system_prompt


__all__ = [
    "build_image_generation_messages",
    "build_image_generation_source_meta",
]
