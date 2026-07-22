"""Consolidated review-mindmap quiz-generation helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.platform.application import AiRuntimeOptions

from ..ai_dependencies import PalaceQuizAiDependencies
from ..question_contracts import (
    QUESTION_TYPES,
    PalaceQuizValidationError,
)
from .chapter_outline import (
    chapter_outline_payload as chapter_outline_payload,
)
from .chapter_outline import (
    generate_quiz_preview_from_chapter_outline as generate_quiz_preview_from_chapter_outline,
)
from .chapter_outline import (
    normalize_outline_question_count as normalize_outline_question_count,
)
from .chapter_outline import (
    normalize_outline_question_types as normalize_outline_question_types,
)
from .shared import (
    build_generation_source_meta,
    build_quiz_generation_preview_result,
    extract_first_multi_node_summary,
    finalize_generation_source_meta,
    node_children,
    node_text,
    normalize_generated_question_drafts,
)


# === quiz_generation_review_mindmap_context.py ===
def compact_mindmap_for_prompt(editor_doc: Any, *, max_nodes: int = 160) -> dict[str, Any]:
    root = (editor_doc or {}).get("root") if isinstance(editor_doc, dict) else None
    if not isinstance(root, dict):
        from memory_anki.modules.mindmap_document.api import (
            deserialize_editor_payload,
        )

        doc = deserialize_editor_payload(editor_doc, {})
        root = doc.get("root") if isinstance(doc, dict) else None
    count = 0

    def walk(node: Any, depth: int = 0) -> dict[str, Any] | None:
        nonlocal count
        if not isinstance(node, dict) or count >= max_nodes:
            return None
        text = node_text(node)
        children = node_children(node)
        count += 1
        return {
            "text": text,
            "children": [
                child_payload
                for child in children
                if (child_payload := walk(child, depth + 1)) is not None
            ],
        }

    compact = walk(root)
    return compact or {"text": "", "children": []}


def build_related_palace_summaries(
    session: Session,
    *,
    current_palace_id: int,
    related_palace_ids: Any,
) -> list[dict[str, Any]]:
    if not isinstance(related_palace_ids, list):
        return []
    normalized_ids: list[int] = []
    for raw_id in related_palace_ids:
        try:
            palace_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if palace_id > 0 and palace_id != current_palace_id and palace_id not in normalized_ids:
            normalized_ids.append(palace_id)
    if not normalized_ids:
        return []
    rows = (
        session.query(Palace)
        .filter(
            Palace.id.in_(normalized_ids),
            Palace.deleted_at.is_(None),
        )
        .order_by(Palace.id.asc())
        .all()
    )
    summaries: list[dict[str, Any]] = []
    for palace in rows:
        first_multi_nodes = extract_first_multi_node_summary(palace.editor_doc)
        if not first_multi_nodes:
            continue
        subject = None
        primary_chapter = getattr(palace, "primary_chapter", None)
        if primary_chapter is not None and getattr(primary_chapter, "subject", None) is not None:
            subject = {
                "id": primary_chapter.subject.id,
                "name": primary_chapter.subject.name,
            }
        summaries.append(
            {
                "palace_id": palace.id,
                "title": palace.title,
                "subject": subject,
                "first_multi_nodes": first_multi_nodes,
            }
        )
    return summaries

# === quiz_generation_review_mindmap_support.py ===
REVIEW_MINDMAP_QUESTION_TYPES = {
    "multiple_choice": "选择题",
    "true_false": "判断题",
    "fill_blank": "填空题",
    "matching": "连线题",
    "ordering": "排序题",
    "categorization": "归类题",
    "short_answer": "简答题",
}


def normalize_review_mindmap_mode(raw_mode: Any) -> str:
    normalized_mode = str(raw_mode or "chapter").strip()
    if normalized_mode not in {"chapter", "cross_palace"}:
        raise PalaceQuizValidationError("做题休息模式必须是 chapter 或 cross_palace。")
    return normalized_mode


def normalize_review_mindmap_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in REVIEW_MINDMAP_QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    if not normalized:
        normalized = list(REVIEW_MINDMAP_QUESTION_TYPES.keys())
    invalid = [item for item in normalized if item not in QUESTION_TYPES]
    if invalid:
        raise PalaceQuizValidationError("包含暂不支持的题型：" + "、".join(invalid))
    return normalized


def normalize_review_mindmap_question_count(raw_question_count: Any) -> int:
    try:
        question_count = int(raw_question_count)
    except (TypeError, ValueError):
        question_count = 5
    return max(1, min(question_count, 12))


def review_mindmap_system_prompt(
    ai_dependencies: PalaceQuizAiDependencies,
) -> str:
    return ai_dependencies.prompts.render("ai_prompt_palace_quiz_review_mindmap")

# === quiz_generation_review_mindmap_request_context.py ===
@dataclass(frozen=True, slots=True)
class ReviewMindmapRequestContext:
    palace: Any
    normalized_mode: str
    normalized_question_types: list[str]
    normalized_question_count: int
    current_mindmap: dict[str, Any]
    related_summaries: list[dict[str, Any]]


def load_review_mindmap_request_context(
    session: Session,
    *,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None,
) -> ReviewMindmapRequestContext:
    from ..questions.queries import get_palace_or_raise

    palace = get_palace_or_raise(session, palace_id)
    normalized_mode = normalize_review_mindmap_mode(mode)
    normalized_question_types = normalize_review_mindmap_question_types(question_types)
    normalized_question_count = normalize_review_mindmap_question_count(question_count)
    current_mindmap = compact_mindmap_for_prompt(review_editor_doc)
    related_summaries = (
        build_related_palace_summaries(
            session,
            current_palace_id=palace_id,
            related_palace_ids=related_palace_ids or [],
        )
        if normalized_mode == "cross_palace"
        else []
    )
    if normalized_mode == "cross_palace" and not related_summaries:
        raise PalaceQuizValidationError("跨宫殿联系模式至少需要一个可用的关联宫殿摘要。")
    return ReviewMindmapRequestContext(
        palace=palace,
        normalized_mode=normalized_mode,
        normalized_question_types=normalized_question_types,
        normalized_question_count=normalized_question_count,
        current_mindmap=current_mindmap,
        related_summaries=related_summaries,
    )

# === quiz_generation_review_mindmap_request_payload.py ===
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
    ai_dependencies: PalaceQuizAiDependencies,
    model_input: dict[str, Any],
    prompt_override: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    system_prompt = (
        str(prompt_override).strip()
        if str(prompt_override or "").strip()
        else review_mindmap_system_prompt(ai_dependencies)
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages

# === quiz_generation_review_mindmap_request.py ===
@dataclass(frozen=True, slots=True)
class ReviewMindmapPreparedRequest:
    palace: Any
    source_meta: dict[str, Any]
    related_summaries: list[dict[str, Any]]
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


def prepare_review_mindmap_generation_request(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None,
    ai_options: AiRuntimeOptions | None,
) -> ReviewMindmapPreparedRequest:
    request_context = load_review_mindmap_request_context(
        session,
        palace_id=palace_id,
        mode=mode,
        question_types=question_types,
        question_count=question_count,
        review_editor_doc=review_editor_doc,
        related_palace_ids=related_palace_ids,
    )
    source_meta = build_review_mindmap_generation_source_meta(request_context)
    model_input = build_review_mindmap_generation_model_input(request_context)
    system_prompt, messages = build_review_mindmap_generation_messages(
        ai_dependencies=ai_dependencies,
        model_input=model_input,
        prompt_override=ai_options.prompt_override if ai_options else None,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        ai_runtime=ai_dependencies.runtime,
        scenario_key="quiz_review_mindmap_generation",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    return ReviewMindmapPreparedRequest(
        palace=request_context.palace,
        source_meta=source_meta,
        related_summaries=request_context.related_summaries,
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

# === quiz_generation_review_mindmap_preview.py ===
def build_review_mindmap_preview_result(
    *,
    prepared_request: ReviewMindmapPreparedRequest,
    palace_id: int,
    response_text: str,
    log_id: str,
) -> dict[str, Any]:
    source_meta = prepared_request.source_meta
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=None,
        resolved_ai=prepared_request.resolved_ai,
        extra_fields={"related_palace_summaries": prepared_request.related_summaries},
    )

# === quiz_generation_review_mindmap_runtime.py ===
def generate_quiz_preview_from_review_mindmap(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    prepared_request = prepare_review_mindmap_generation_request(
        session,
        ai_dependencies=ai_dependencies,
        palace_id=palace_id,
        mode=mode,
        question_types=question_types,
        question_count=question_count,
        review_editor_doc=review_editor_doc,
        related_palace_ids=related_palace_ids,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_review_mindmap",
        palace_id=palace_id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    return build_review_mindmap_preview_result(
        prepared_request=prepared_request,
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
    )

# === quiz_generation_review_mindmap.py ===


# === quiz_generation_review.py ===


__all__ = [
    "REVIEW_MINDMAP_QUESTION_TYPES",
    "ReviewMindmapPreparedRequest",
    "ReviewMindmapRequestContext",
    "build_related_palace_summaries",
    "build_review_mindmap_preview_result",
    "load_review_mindmap_request_context",
    "compact_mindmap_for_prompt",
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_review_mindmap",
    "normalize_outline_question_count",
    "normalize_outline_question_types",
    "normalize_review_mindmap_question_count",
    "normalize_review_mindmap_question_types",
    "prepare_review_mindmap_generation_request",
    "review_mindmap_system_prompt",
]
