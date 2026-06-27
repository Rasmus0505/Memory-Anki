"""Payload assembly for review-mindmap quiz generation requests."""

from __future__ import annotations

import json
from typing import Any

from ._question_utils import build_generation_source_meta
from .quiz_generation_review_mindmap_request_context import ReviewMindmapRequestContext
from .quiz_generation_review_mindmap_support import (
    REVIEW_MINDMAP_QUESTION_TYPES,
    review_mindmap_system_prompt,
)


def build_review_mindmap_generation_source_meta(
    context: ReviewMindmapRequestContext,
) -> dict[str, Any]:
    source_meta = build_generation_source_meta(
        source_kind="review_mindmap",
        generation_mode=(
            "review_cross_palace"
            if context.normalized_mode == "cross_palace"
            else "review_chapter"
        ),
        extra_prompt="",
    )
    source_meta.update(
        {
            "review_mode": context.normalized_mode,
            "question_types": context.normalized_question_types,
            "question_count": context.normalized_question_count,
            "related_palace_ids": [item["palace_id"] for item in context.related_summaries],
            "related_palace_summaries": context.related_summaries,
        }
    )
    return source_meta


def build_review_mindmap_generation_model_input(
    context: ReviewMindmapRequestContext,
) -> dict[str, Any]:
    return {
        "current_palace": {"id": context.palace.id, "title": context.palace.title},
        "mode": context.normalized_mode,
        "question_count": context.normalized_question_count,
        "allowed_question_types": [
            {"type": item, "label": REVIEW_MINDMAP_QUESTION_TYPES[item]}
            for item in context.normalized_question_types
        ],
        "current_review_mindmap": context.current_mindmap,
        "related_palaces": context.related_summaries,
    }


def build_review_mindmap_generation_messages(
    model_input: dict[str, Any],
    prompt_override: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    system_prompt = (
        str(prompt_override).strip()
        if str(prompt_override or "").strip()
        else review_mindmap_system_prompt()
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages


__all__ = [
    "build_review_mindmap_generation_messages",
    "build_review_mindmap_generation_model_input",
    "build_review_mindmap_generation_source_meta",
]
