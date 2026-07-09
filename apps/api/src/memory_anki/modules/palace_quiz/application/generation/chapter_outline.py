"""Consolidated chapter-outline quiz-generation helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from ..question_contracts import QUESTION_TYPES, PalaceQuizValidationError
from .shared import (
    apply_source_chapter_to_drafts,
    build_generation_source_meta,
    build_quiz_generation_preview_result,
    finalize_generation_source_meta,
    flatten_child_chapter_contexts,
    group_questions_for_child_chapter_preview,
    normalize_generated_question_drafts,
)


# === quiz_generation_chapter_outline_support.py ===
def normalize_outline_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    return normalized or ["multiple_choice", "short_answer"]


def normalize_outline_question_count(raw_question_count: Any) -> int:
    try:
        count = int(raw_question_count or 5)
    except (TypeError, ValueError):
        count = 5
    return max(1, min(count, 30))


def chapter_outline_payload(chapter: Chapter) -> dict[str, Any]:
    return {
        "id": chapter.id,
        "name": chapter.name,
        "notes": str(chapter.notes or "").strip(),
        "children": [chapter_outline_payload(child) for child in (chapter.children or [])],
    }

# === quiz_generation_chapter_outline_request_context.py ===
@dataclass(frozen=True, slots=True)
class ChapterOutlineRequestContext:
    chapter: Chapter
    normalized_question_types: list[str]
    normalized_question_count: int
    child_contexts: list[dict[str, Any]]


def load_chapter_outline_request_context(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    classify_by_child_chapter: bool,
) -> ChapterOutlineRequestContext:
    from ..questions.validation import get_chapter_or_raise

    chapter = get_chapter_or_raise(session, chapter_id)
    normalized_question_types = normalize_outline_question_types(question_types)
    normalized_question_count = normalize_outline_question_count(question_count)
    child_contexts = flatten_child_chapter_contexts(chapter)
    if classify_by_child_chapter and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前章节没有下级小节，暂时无法按宫殿分类。")
    return ChapterOutlineRequestContext(
        chapter=chapter,
        normalized_question_types=normalized_question_types,
        normalized_question_count=normalized_question_count,
        child_contexts=child_contexts,
    )

# === quiz_generation_chapter_outline_request_payload.py ===
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

# === quiz_generation_chapter_outline_request.py ===
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
    from .. import ai_service

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
        prompt_override=ai_options.prompt_override if ai_options else None,
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

# === quiz_generation_chapter_outline_preview.py ===
def build_chapter_outline_preview_result(
    session: Session,
    *,
    prepared_request: ChapterOutlinePreparedRequest,
    chapter_id: int,
    response_text: str,
    log_id: str,
    classify_by_child_chapter: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    source_meta = prepared_request.source_meta
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    apply_source_chapter_to_drafts(drafts, chapter_id=prepared_request.chapter.id)
    grouped_questions = None
    if classify_by_child_chapter:
        grouped_questions = group_questions_for_child_chapter_preview(
            session=session,
            drafts=drafts,
            child_contexts=prepared_request.child_contexts,
            feature="章节做题",
            operation="chapter_quiz_group_by_child_chapter",
            ai_options=ai_options,
        )
        source_meta["generation_mode"] = "chapter_outline_grouped"
    return build_quiz_generation_preview_result(
        scope_key="chapter_id",
        scope_id=chapter_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=grouped_questions,
        resolved_ai=prepared_request.resolved_ai,
    )

# === quiz_generation_chapter_outline.py ===
def _ai_service():
    from .. import ai_service

    return ai_service


def generate_quiz_preview_from_chapter_outline(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    extra_prompt: str,
    classify_by_child_chapter: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_chapter_outline_generation_request(
        session,
        chapter_id=chapter_id,
        question_types=question_types,
        question_count=question_count,
        extra_prompt=extra_prompt,
        classify_by_child_chapter=classify_by_child_chapter,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="章节做题",
        operation="chapter_quiz_generate_outline",
        palace_id=None,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    return build_chapter_outline_preview_result(
        session,
        prepared_request=prepared_request,
        chapter_id=chapter_id,
        response_text=response_text,
        log_id=log_id,
        classify_by_child_chapter=classify_by_child_chapter,
        ai_options=ai_options,
    )

__all__ = [
    "ChapterOutlinePreparedRequest",
    "ChapterOutlineRequestContext",
    "build_chapter_outline_generation_messages",
    "build_chapter_outline_generation_model_input",
    "build_chapter_outline_generation_source_meta",
    "build_chapter_outline_preview_result",
    "chapter_outline_payload",
    "generate_quiz_preview_from_chapter_outline",
    "load_chapter_outline_request_context",
    "normalize_outline_question_count",
    "normalize_outline_question_types",
    "prepare_chapter_outline_generation_request",
]
