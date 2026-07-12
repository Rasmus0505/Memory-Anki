"""Mini-palace quiz grouping and classification."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.mindmap_document.api import collect_node_descendants
from memory_anki.modules.palaces.api import parse_mini_palace_node_uids
from memory_anki.platform.application import AiRuntimeOptions

from .. import ai_service as _ai
from .._question_utils import extract_mini_palace_grouping_payload
from ..ai_dependencies import PalaceQuizAiDependencies
from ..question_contracts import PalaceQuizValidationError
from ..question_schema import serialize_question_rows
from ..questions.commands import upsert_classified_question_copy
from ..questions.queries import get_palace_or_raise, list_root_question_rows


@dataclass(frozen=True, slots=True)
class MiniPalaceGroupingPreparedRequest:
    mini_palace_contexts: list[dict[str, Any]]
    system_prompt: str
    model_input: dict[str, Any]
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ExistingQuestionGroupingRequest:
    palace: Any
    source_questions: list[Any]
    source_payloads: list[dict[str, object]]
    ai_options: AiRuntimeOptions | None


def build_mini_palace_context(palace: Any) -> list[dict[str, Any]]:
    _, labels = collect_node_descendants(getattr(palace, "editor_doc", None))
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
        payload["correct_option_id"] = (question.get("answer_payload", {}) or {}).get(
            "correct_option_id"
        )
    else:
        payload["reference_answer"] = (question.get("answer_payload", {}) or {}).get(
            "reference_answer"
        )
    return payload


def prepare_mini_palace_grouping_request(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> MiniPalaceGroupingPreparedRequest:
    mini_palace_contexts = build_mini_palace_context(palace)
    if len(mini_palace_contexts) == 0:
        raise PalaceQuizValidationError("当前宫殿还没有迷你宫殿训练，暂时无法按迷你宫殿训练分类。")
    if len(questions) == 0:
        raise PalaceQuizValidationError("没有可分类的题目。")

    system_prompt = (
        ai_options.prompt_override.strip()
        if ai_options and ai_options.prompt_override and ai_options.prompt_override.strip()
        else ai_dependencies.prompts.render(operation)
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
        ai_runtime=ai_dependencies.runtime,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    return MiniPalaceGroupingPreparedRequest(
        mini_palace_contexts=mini_palace_contexts,
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
            mini_palace_id_int = int(mini_palace_id) if mini_palace_id is not None else 0
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
    ai_dependencies: PalaceQuizAiDependencies,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    prepared_request = prepare_mini_palace_grouping_request(
        session,
        ai_dependencies=ai_dependencies,
        palace=palace,
        questions=questions,
        operation=operation,
        ai_options=ai_options,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation=operation,
        palace_id=palace.id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    grouping_payload = extract_mini_palace_grouping_payload(response_text)
    grouped_preview = build_grouped_preview_from_indexes(
        questions=questions,
        grouping_payload=grouping_payload,
        mini_palace_contexts=prepared_request.mini_palace_contexts,
    )
    return grouped_preview, log_id, prepared_request.resolved_ai


def apply_grouped_question_copies(
    session: Session,
    *,
    source_questions: list[Any],
    grouped_preview: dict[str, Any],
) -> tuple[int, list[dict[str, Any]]]:
    source_by_origin = {question.id: question for question in source_questions}
    created_or_updated = 0
    mini_palace_hit_counts: list[dict[str, Any]] = []
    for group in grouped_preview["mini_palace_groups"]:
        mini_palace_id = int(group["mini_palace_id"])
        question_items = group.get("questions") or []
        hit_count = 0
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
                "mini_palace_name": group.get("mini_palace_name") or f"迷你宫殿训练 {mini_palace_id}",
                "question_count": hit_count,
            }
        )
    return created_or_updated, mini_palace_hit_counts


def prepare_existing_question_grouping_request(
    session: Session,
    *,
    palace_id: int,
    ai_options: AiRuntimeOptions | None,
) -> ExistingQuestionGroupingRequest:
    palace = get_palace_or_raise(session, palace_id)
    source_questions = list_root_question_rows(session, palace_id=palace_id)
    if len(source_questions) == 0:
        raise PalaceQuizValidationError("当前大宫殿题库还没有可归类的题目。")
    return ExistingQuestionGroupingRequest(
        palace=palace,
        source_questions=source_questions,
        source_payloads=serialize_question_rows(source_questions),
        ai_options=ai_options,
    )


def classify_existing_quiz_questions_to_mini_palaces(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace_id: int,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_existing_question_grouping_request(
        session,
        palace_id=palace_id,
        ai_options=ai_options,
    )
    grouped_preview, log_id, _resolved_ai = group_questions_by_mini_palaces(
        session,
        ai_dependencies=ai_dependencies,
        palace=prepared_request.palace,
        questions=prepared_request.source_payloads,
        operation="ai_prompt_palace_quiz_classify_existing_to_mini_palace",
        ai_options=prepared_request.ai_options,
    )
    created_or_updated, mini_palace_hit_counts = apply_grouped_question_copies(
        session,
        source_questions=prepared_request.source_questions,
        grouped_preview=grouped_preview,
    )
    session.commit()
    return {
        "palace_id": palace_id,
        "mini_palace_groups": mini_palace_hit_counts,
        "unassigned_count": len(grouped_preview.get("unassigned_questions") or []),
        "ai_call_log_id": log_id,
        "copied_question_count": created_or_updated,
    }


__all__ = [
    "ExistingQuestionGroupingRequest",
    "MiniPalaceGroupingPreparedRequest",
    "apply_grouped_question_copies",
    "build_grouped_preview_from_indexes",
    "build_mini_palace_context",
    "classify_existing_quiz_questions_to_mini_palaces",
    "group_questions_by_mini_palaces",
    "prepare_existing_question_grouping_request",
    "prepare_mini_palace_grouping_request",
    "question_payload_for_grouping",
]
