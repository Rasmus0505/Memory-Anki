"""Consolidated child-chapter quiz-generation helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog
from memory_anki.infrastructure.llm.external_ai_call_logs import get_external_ai_call_log
from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from ..question_contracts import PalaceQuizValidationError
from ..quiz_grouping_context import question_payload_for_grouping
from .shared import (
    extract_mini_palace_grouping_payload as _extract_mini_palace_grouping_payload,
)


# === quiz_generation_child_chapter_context.py ===
def flatten_child_chapter_contexts(chapter: Chapter) -> list[dict[str, object]]:
    contexts: list[dict[str, object]] = []
    for child in chapter.children or []:
        contexts.append(
            {
                "mini_palace_id": child.id,
                "name": child.name,
                "node_texts": [child.name, str(child.notes or "").strip()],
                "node_text_summary": "；".join(
                    [item for item in [child.name, str(child.notes or "").strip()] if item]
                ),
            }
        )
    return contexts

# === quiz_generation_child_chapter_preview.py ===
def build_group_questions_by_child_chapter_preview(
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    grouping_payload: dict[str, object],
) -> dict[str, object]:
    grouped_items: list[dict[str, object]] = []
    assigned_indexes: set[int] = set()
    context_by_id = {
        int(raw_id): item
        for item in child_contexts
        if isinstance((raw_id := item.get("mini_palace_id")), int)
    }
    raw_groups = grouping_payload.get("mini_palace_groups")
    groups = raw_groups if isinstance(raw_groups, list) else []
    for item in groups:
        if not isinstance(item, dict):
            continue
        try:
            raw_child_chapter_id = item.get("mini_palace_id")
            child_chapter_id = int(raw_child_chapter_id) if raw_child_chapter_id is not None else 0
        except (TypeError, ValueError):
            continue
        question_indexes = item.get("question_indexes")
        if not isinstance(question_indexes, list):
            continue
        if child_chapter_id not in context_by_id:
            raise PalaceQuizValidationError("章节分类节点必须是当前章节的直接子章节。")
        group_questions: list[dict[str, object]] = []
        for raw_index in question_indexes:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(drafts) and index not in assigned_indexes:
                assigned_indexes.add(index)
                group_questions.append(
                    {
                        **drafts[index],
                        "classified_chapter_id": child_chapter_id,
                        "mini_palace_id": None,
                    }
                )
        if group_questions:
            grouped_items.append(
                {
                    "classified_chapter_id": child_chapter_id,
                    "classified_chapter_name": context_by_id[child_chapter_id]["name"],
                    "questions": group_questions,
                }
            )
    unassigned_questions: list[dict[str, object]] = []
    for index, question in enumerate(drafts):
        if index in assigned_indexes:
            continue
        unassigned_questions.append({**question, "classified_chapter_id": None})
    return {
        "child_chapter_groups": grouped_items,
        "unassigned_questions": unassigned_questions,
    }

# === quiz_generation_child_chapter_request_payload.py ===
def build_child_chapter_grouping_model_input(
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
) -> dict[str, Any]:
    return {
        "mini_palaces": child_contexts,
        "questions": [
            question_payload_for_grouping(question, index)
            for index, question in enumerate(drafts)
        ],
    }


def build_child_chapter_grouping_messages(
    *,
    session: Session,
    model_input: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    system_prompt = render_prompt(
        "ai_prompt_palace_quiz_group_by_mini_palace",
        {},
        session=session,
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages

# === quiz_generation_child_chapter_request.py ===
@dataclass(frozen=True, slots=True)
class ChildChapterGroupingPreparedRequest:
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


def prepare_child_chapter_grouping_request(
    session: Session,
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    ai_options: AiRuntimeOptions | None = None,
) -> ChildChapterGroupingPreparedRequest:
    model_input = build_child_chapter_grouping_model_input(
        drafts=drafts,
        child_contexts=child_contexts,
    )
    system_prompt, messages = build_child_chapter_grouping_messages(
        session=session,
        model_input=model_input,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    return ChildChapterGroupingPreparedRequest(
        system_prompt=system_prompt,
        model_input=model_input,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "resolved_ai": resolved_ai,
        },
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
    )

# === quiz_generation_child_chapter_ai_runtime.py ===
def group_questions_by_child_chapters(
    session: Session,
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    feature: str,
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_child_chapter_grouping_request(
        session,
        drafts=drafts,
        child_contexts=child_contexts,
        ai_options=ai_options,
    )
    grouping_response_text, _ = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature=feature,
        operation=operation,
        palace_id=None,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    grouping_payload = _extract_mini_palace_grouping_payload(grouping_response_text)
    return build_group_questions_by_child_chapter_preview(
        drafts=drafts,
        child_contexts=child_contexts,
        grouping_payload=grouping_payload,
    )

# === quiz_generation_child_chapter_log_reuse.py ===
def _iter_candidate_grouping_logs(
    session: Session,
    *,
    source_log_id: str,
):
    source_log = session.query(ExternalAiCallLog).filter_by(id=source_log_id).first()
    if not source_log or source_log.created_at is None:
        return []
    return (
        session.query(ExternalAiCallLog)
        .filter(ExternalAiCallLog.operation == "palace_quiz_group_by_child_chapter")
        .filter(ExternalAiCallLog.status == "success")
        .filter(ExternalAiCallLog.created_at >= source_log.created_at)
        .order_by(ExternalAiCallLog.created_at.asc(), ExternalAiCallLog.id.asc())
        .limit(12)
        .all()
    )


def _payload_matches_child_chapter_request(
    *,
    model_input: dict[str, Any],
    drafts: list[dict[str, object]],
    expected_child_ids: set[int],
) -> bool:
    questions = model_input.get("questions")
    mini_palaces = model_input.get("mini_palaces")
    if not isinstance(questions, list) or len(questions) != len(drafts):
        return False
    if not isinstance(mini_palaces, list):
        return False
    mini_palace_ids: set[int] = set()
    for item in mini_palaces:
        if not isinstance(item, dict):
            continue
        raw_mini_palace_id = item.get("mini_palace_id")
        if raw_mini_palace_id is not None:
            mini_palace_ids.add(int(raw_mini_palace_id))
    return mini_palace_ids == expected_child_ids


def reuse_grouped_child_chapter_questions_from_log(
    session: Session,
    *,
    ai_call_log_id: str,
    selected_chapter: Chapter,
    drafts: list[dict[str, object]],
) -> dict[str, object] | None:
    candidate_rows = _iter_candidate_grouping_logs(
        session,
        source_log_id=ai_call_log_id,
    )
    expected_child_ids = {child.id for child in selected_chapter.children or []}
    child_contexts = flatten_child_chapter_contexts(selected_chapter)
    for row in candidate_rows:
        payload = get_external_ai_call_log(session, row.id)
        if not payload:
            continue
        request_payload = payload.get("request_payload") or {}
        model_input = request_payload.get("model_input") if isinstance(request_payload, dict) else {}
        if not isinstance(model_input, dict):
            continue
        if not _payload_matches_child_chapter_request(
            model_input=model_input,
            drafts=drafts,
            expected_child_ids=expected_child_ids,
        ):
            continue
        response_payload = payload.get("response_payload") or {}
        response_text = str(response_payload.get("response_text") or "").strip()
        if not response_text:
            continue
        grouping_payload = _extract_mini_palace_grouping_payload(response_text)
        return build_group_questions_by_child_chapter_preview(
            drafts=drafts,
            child_contexts=child_contexts,
            grouping_payload=grouping_payload,
        )
    return None

# === quiz_generation_chapter_grouping.py ===


__all__ = [
    "ChildChapterGroupingPreparedRequest",
    "build_child_chapter_grouping_messages",
    "build_child_chapter_grouping_model_input",
    "build_group_questions_by_child_chapter_preview",
    "flatten_child_chapter_contexts",
    "group_questions_by_child_chapters",
    "prepare_child_chapter_grouping_request",
    "reuse_grouped_child_chapter_questions_from_log",
]
