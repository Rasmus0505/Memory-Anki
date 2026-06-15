"""Quiz question grouping into mini-palaces.

Extracted from the original ``ai_service.py`` to reduce its size. The
grouping flow (classify questions to mini-palaces) is self-contained and
touches the shared AI runtime only through ``ai_service._call_logged_chat_completion``
and ``ai_service._build_chat_config``.

Module-attribute access (``_ai.X``) is used deliberately for those names so
that ``unittest.mock.patch.object(ai_service, "_call_logged_chat_completion", ...)``
keeps working from the route tests.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.palaces.application.mini_palace_service import (
    parse_mini_palace_node_uids,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    collect_doc_nodes_with_descendants,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from . import ai_service as _ai
from ._question_utils import extract_mini_palace_grouping_payload
from .service import (
    PalaceQuizValidationError,
    get_palace_or_raise,
    list_root_questions,
    serialize_question,
    upsert_classified_question_copy,
)


def build_mini_palace_context(palace: Any) -> list[dict[str, Any]]:
    _, labels = collect_doc_nodes_with_descendants(getattr(palace, "editor_doc", None))
    contexts: list[dict[str, Any]] = []
    for mini_palace in getattr(palace, "mini_palaces", []) or []:
        node_uids = parse_mini_palace_node_uids(getattr(mini_palace, "node_uids_json", None))
        node_texts = [labels.get(uid, uid) for uid in node_uids if labels.get(uid, uid)]
        contexts.append(
            {
                "mini_palace_id": mini_palace.id,
                "name": mini_palace.name,
                "node_uids": node_uids,
                "node_texts": node_texts[:24],
                "node_text_summary": "；".join(node_texts[:12]),
            }
        )
    return contexts


def question_payload_for_grouping(question: dict[str, Any], index: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "question_index": index,
        "question_type": question.get("question_type"),
        "stem": question.get("stem"),
        "analysis": question.get("analysis"),
    }
    if question.get("question_type") == "multiple_choice":
        payload["options"] = question.get("options") or []
        payload["correct_option_id"] = (
            question.get("answer_payload", {}) or {}
        ).get("correct_option_id")
    else:
        payload["reference_answer"] = (
            question.get("answer_payload", {}) or {}
        ).get("reference_answer")
    return payload


def build_grouped_preview_from_indexes(
    *,
    questions: list[dict[str, Any]],
    grouping_payload: dict[str, Any],
    mini_palace_contexts: list[dict[str, Any]],
) -> dict[str, Any]:
    question_count = len(questions)
    context_by_id = {
        int(item["mini_palace_id"]): item
        for item in mini_palace_contexts
        if item.get("mini_palace_id") is not None
    }
    grouped_questions: list[dict[str, Any]] = []
    assigned_indexes: set[int] = set()
    for item in grouping_payload.get("mini_palace_groups", []):
        if not isinstance(item, dict):
            continue
        mini_palace_id = item.get("mini_palace_id")
        question_indexes_raw = item.get("question_indexes")
        try:
            mini_palace_id_int = int(mini_palace_id)
        except (TypeError, ValueError):
            continue
        if mini_palace_id_int not in context_by_id or not isinstance(question_indexes_raw, list):
            continue
        question_indexes: list[int] = []
        for raw_index in question_indexes_raw:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < question_count and index not in question_indexes:
                question_indexes.append(index)
                assigned_indexes.add(index)
        if not question_indexes:
            continue
        grouped_questions.append(
            {
                "mini_palace_id": mini_palace_id_int,
                "mini_palace_name": context_by_id[mini_palace_id_int]["name"],
                "questions": [
                    {
                        **questions[index],
                        "mini_palace_id": mini_palace_id_int,
                    }
                    for index in question_indexes
                ],
            }
        )

    unassigned_indexes_raw = grouping_payload.get("unassigned_question_indexes", [])
    unassigned_indexes: list[int] = []
    for raw_index in unassigned_indexes_raw:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if 0 <= index < question_count and index not in unassigned_indexes:
            unassigned_indexes.append(index)
    if not unassigned_indexes:
        unassigned_indexes = [index for index in range(question_count) if index not in assigned_indexes]

    return {
        "mini_palace_groups": grouped_questions,
        "unassigned_questions": [questions[index] for index in unassigned_indexes],
    }


def group_questions_by_mini_palaces(
    session: Session,
    *,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    mini_palace_contexts = build_mini_palace_context(palace)
    if len(mini_palace_contexts) == 0:
        raise PalaceQuizValidationError("当前宫殿还没有小宫殿，暂时无法按小宫殿分类。")
    if len(questions) == 0:
        raise PalaceQuizValidationError("没有可分类的题目。")
    system_prompt = render_prompt(
        operation,
        {},
        session=session,
    )
    model_input = {
        "mini_palaces": mini_palace_contexts,
        "questions": [
            question_payload_for_grouping(question, index)
            for index, question in enumerate(questions)
        ],
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation=operation,
        palace_id=palace.id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "resolved_ai": resolved_ai,
        },
    )
    grouping_payload = extract_mini_palace_grouping_payload(response_text)
    grouped_preview = build_grouped_preview_from_indexes(
        questions=questions,
        grouping_payload=grouping_payload,
        mini_palace_contexts=mini_palace_contexts,
    )
    return grouped_preview, log_id, resolved_ai




def classify_existing_quiz_questions_to_mini_palaces(
    session: Session,
    *,
    palace_id: int,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    palace = get_palace_or_raise(session, palace_id)
    source_questions = list_root_questions(session, palace_id)
    if len(source_questions) == 0:
        raise PalaceQuizValidationError("当前大宫殿题库还没有可归类的题目。")
    source_payloads = [serialize_question(question) for question in source_questions]
    grouped_preview, log_id, resolved_ai = group_questions_by_mini_palaces(
        session,
        palace=palace,
        questions=source_payloads,
        operation="ai_prompt_palace_quiz_classify_existing_to_mini_palace",
        ai_options=ai_options,
    )
    created_or_updated = 0
    mini_palace_hit_counts: list[dict[str, Any]] = []
    for group in grouped_preview["mini_palace_groups"]:
        mini_palace_id = int(group["mini_palace_id"])
        question_items = group.get("questions") or []
        hit_count = 0
        source_by_origin = {
            question.id: question
            for question in source_questions
        }
        for item in question_items:
            origin_question_id = item.get("origin_question_id") or item.get("id")
            try:
                origin_question_id_int = int(origin_question_id)
            except (TypeError, ValueError):
                continue
            source_question = source_by_origin.get(origin_question_id_int)
            if source_question is None:
                continue
            upsert_classified_question_copy(
                session,
                source_question=source_question,
                mini_palace_id=mini_palace_id,
            )
            hit_count += 1
            created_or_updated += 1
        mini_palace_hit_counts.append(
            {
                "mini_palace_id": mini_palace_id,
                "mini_palace_name": group.get("mini_palace_name") or f"小宫殿 {mini_palace_id}",
                "question_count": hit_count,
            }
        )
    session.commit()
    return {
        "palace_id": palace_id,
        "mini_palace_groups": mini_palace_hit_counts,
        "unassigned_count": len(grouped_preview.get("unassigned_questions") or []),
        "ai_call_log_id": log_id,
        "copied_question_count": created_or_updated,
    }
