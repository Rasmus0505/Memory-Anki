"""Payload assembly for text-file quiz generation requests."""

from __future__ import annotations

import json
from typing import Any

from memory_anki.modules.settings.application.ai_prompt_templates import (
    build_palace_quiz_text_formatting_prompt,
)

from ._question_utils import build_generation_source_meta
from .quiz_generation_image_request_context import ImageGenerationRequestContext


def build_text_generation_source_meta(
    *,
    context: ImageGenerationRequestContext,
    file_artifacts: list[dict[str, Any]],
    extra_prompt: str,
) -> dict[str, Any]:
    file_names = [str(item.get("filename") or f"text-{index + 1}.txt") for index, item in enumerate(file_artifacts)]
    source_meta = build_generation_source_meta(
        source_kind="text_files",
        generation_mode="text_files_multi" if len(file_artifacts) > 1 else "text_files",
        extra_prompt=extra_prompt,
        image_names=file_names,
    )
    if context.selected_chapter is not None:
        source_meta["source_chapter_id"] = context.selected_chapter.id
    return source_meta


def build_text_generation_model_input(
    *,
    file_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "files": [
            {
                "filename": item.get("filename"),
                "extension": item.get("extension"),
                "mime_type": item.get("mime_type"),
                "content": item.get("decoded_text"),
            }
            for item in file_artifacts
        ]
    }


def build_text_generation_messages(
    *,
    extra_prompt: str,
    file_artifacts: list[dict[str, Any]],
    prompt_override: str | None = None,
) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    system_prompt = (
        str(prompt_override).strip()
        if prompt_override and str(prompt_override).strip()
        else build_palace_quiz_text_formatting_prompt(extra_prompt)
    )
    model_input = build_text_generation_model_input(file_artifacts=file_artifacts)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return messages, system_prompt, model_input


__all__ = [
    "build_text_generation_messages",
    "build_text_generation_model_input",
    "build_text_generation_source_meta",
]
