"""Payload assembly for chapter-outline quiz generation requests."""

from __future__ import annotations

import json

from memory_anki.modules.settings.application.ai_prompts import render_prompt

from ._question_utils import build_generation_source_meta
from .quiz_generation_chapter_outline_request_context import ChapterOutlineRequestContext
from .quiz_generation_chapter_outline_support import chapter_outline_payload


def build_chapter_outline_generation_source_meta(
    *,
    context: ChapterOutlineRequestContext,
    extra_prompt: str,
    classify_by_child_chapter: bool,
) -> dict[str, object]:
    source_meta = build_generation_source_meta(
        source_kind="chapter_outline",
        generation_mode="chapter_outline_grouped" if classify_by_child_chapter else "chapter_outline",
        extra_prompt=extra_prompt,
    )
    source_meta["source_chapter_id"] = context.chapter.id
    return source_meta


def build_chapter_outline_generation_model_input(
    context: ChapterOutlineRequestContext,
) -> dict[str, object]:
    return {
        "selected_chapter": chapter_outline_payload(context.chapter),
        "question_count": context.normalized_question_count,
        "allowed_question_types": context.normalized_question_types,
        "task": "请严格基于所给章节与下级小节内容生成题目，不要扩展到该章节范围之外。",
    }


def build_chapter_outline_generation_messages(
    *,
    session,
    model_input: dict[str, object],
    extra_prompt: str,
    prompt_override: str | None = None,
) -> tuple[str, list[dict[str, object]]]:
    system_prompt = (
        str(prompt_override).strip()
        if str(prompt_override or "").strip()
        else render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    )
    messages: list[dict[str, object]] = [{"role": "system", "content": system_prompt}]
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        messages.append(
            {
                "role": "system",
                "content": "用户临时补充要求必须优先严格遵守。\n" + normalized_extra_prompt,
            }
        )
    messages.append({"role": "user", "content": json.dumps(model_input, ensure_ascii=False)})
    return system_prompt, messages


__all__ = [
    "build_chapter_outline_generation_messages",
    "build_chapter_outline_generation_model_input",
    "build_chapter_outline_generation_source_meta",
]
