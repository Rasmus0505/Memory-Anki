"""AI preview helpers for quiz↔node bindings."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.platform.application import AiRuntimeOptions, extract_first_json_object

from . import ai_service as _ai
from ._question_utils import PalaceQuizAiError
from .ai_dependencies import PalaceQuizAiDependencies
from .node_binding import (
    DEFAULT_BATCH_SIZE,
    MAX_BINDINGS_PER_QUESTION,
    PROMPT_KEY,
    SCENARIO_KEY,
    _coerce_int,
    _existing_binding_edges,
    compact_mindmap_with_uids,
)
from .question_contracts import PalaceQuizValidationError
from .question_schema import serialize_question_rows
from .questions.queries import get_palace_or_raise, list_root_question_rows

MergeMode = Literal["replace_all", "fill_unbound"]

def _question_payload_for_binding(question: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": question.get("id"),
        "question_type": question.get("question_type"),
        "stem": str(question.get("stem") or "")[:800],
        "analysis": str(question.get("analysis") or "")[:400],
    }
    if question.get("question_type") == "multiple_choice":
        options = question.get("options") or []
        if isinstance(options, list):
            payload["options"] = [
                {
                    "id": item.get("id"),
                    "text": str(item.get("text") or "")[:200],
                }
                for item in options
                if isinstance(item, dict)
            ][:8]
    return payload


def _parse_binding_response(
    response_text: str,
    *,
    allowed_question_ids: set[int],
    allowed_node_uids: set[str],
) -> tuple[list[dict[str, Any]], list[int], list[str]]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError("AI 返回的题库结合 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError("AI 返回的题库结合结果不是对象。")

    bindings_raw = parsed.get("bindings")
    if not isinstance(bindings_raw, list):
        raise PalaceQuizAiError("AI 没有返回 bindings 列表。")

    bindings: list[dict[str, Any]] = []
    warnings: list[str] = []
    bound_question_ids: set[int] = set()

    for item in bindings_raw:
        if not isinstance(item, dict):
            warnings.append("忽略非对象 binding 条目。")
            continue
        raw_question_id = item.get("question_id")
        try:
            if raw_question_id is None:
                raise TypeError("missing question_id")
            question_id = int(raw_question_id)
        except (TypeError, ValueError):
            warnings.append("忽略缺少 question_id 的 binding。")
            continue
        if question_id not in allowed_question_ids:
            warnings.append(f"忽略未知题目 {question_id}。")
            continue
        node_uids_raw = item.get("node_uids")
        if not isinstance(node_uids_raw, list):
            warnings.append(f"题目 {question_id} 的 node_uids 无效。")
            continue
        node_uids: list[str] = []
        for raw_uid in node_uids_raw:
            uid = str(raw_uid or "").strip()
            if not uid:
                continue
            if uid not in allowed_node_uids:
                warnings.append(f"题目 {question_id} 引用了未知节点 {uid}。")
                continue
            if uid not in node_uids:
                node_uids.append(uid)
            if len(node_uids) >= MAX_BINDINGS_PER_QUESTION:
                break
        if not node_uids:
            continue
        reason = str(item.get("reason") or "").strip()[:500]
        confidence = item.get("confidence")
        conf_value: float | None
        try:
            conf_value = float(confidence) if confidence is not None else None
        except (TypeError, ValueError):
            conf_value = None
        bindings.append(
            {
                "question_id": question_id,
                "node_uids": node_uids,
                "reason": reason,
                "confidence": conf_value,
            }
        )
        bound_question_ids.add(question_id)

    unbound_raw = parsed.get("unbound_question_ids")
    unbound: list[int] = []
    if isinstance(unbound_raw, list):
        for raw_id in unbound_raw:
            try:
                qid = int(raw_id)
            except (TypeError, ValueError):
                continue
            if qid in allowed_question_ids and qid not in bound_question_ids and qid not in unbound:
                unbound.append(qid)
    for qid in sorted(allowed_question_ids - bound_question_ids):
        if qid not in unbound:
            unbound.append(qid)

    return bindings, unbound, warnings


def _merge_preview_bindings(
    *,
    ai_bindings: list[dict[str, Any]],
    existing_edges: list[tuple[int, str]],
    merge_mode: MergeMode,
) -> list[dict[str, Any]]:
    """Normalize to flat list of {question_id, node_uid, reason, confidence, source}."""
    edge_map: dict[tuple[int, str], dict[str, Any]] = {}

    if merge_mode == "fill_unbound":
        for question_id, node_uid in existing_edges:
            edge_map[(question_id, node_uid)] = {
                "question_id": question_id,
                "node_uid": node_uid,
                "reason": "",
                "confidence": None,
                "source": "existing",
            }

    bound_questions_existing = {qid for qid, _ in existing_edges} if merge_mode == "fill_unbound" else set()

    for item in ai_bindings:
        question_id = int(item["question_id"])
        if merge_mode == "fill_unbound" and question_id in bound_questions_existing:
            # Keep existing edges for already-bound questions; do not add AI edges for them.
            continue
        for node_uid in item.get("node_uids") or []:
            key = (question_id, str(node_uid))
            edge_map[key] = {
                "question_id": question_id,
                "node_uid": str(node_uid),
                "reason": str(item.get("reason") or ""),
                "confidence": item.get("confidence"),
                "source": "ai",
            }

    return sorted(
        edge_map.values(),
        key=lambda row: (int(row["question_id"]), str(row["node_uid"])),
    )


def preview_quiz_node_binding(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace_id: int,
    merge_mode: MergeMode = "replace_all",
    batch_size: int = DEFAULT_BATCH_SIZE,
    ai_options: AiRuntimeOptions | None = None,
    operation_id: str | None = None,
) -> dict[str, Any]:
    palace = get_palace_or_raise(session, palace_id)
    question_rows = list_root_question_rows(session, palace_id=palace_id)
    questions = serialize_question_rows(question_rows)
    if not questions:
        raise PalaceQuizValidationError("当前宫殿还没有题目，无法进行题库结合。")

    mindmap_nodes = compact_mindmap_with_uids(getattr(palace, "editor_doc", None))
    if not mindmap_nodes:
        raise PalaceQuizValidationError("当前宫殿思维导图为空，无法进行题库结合。")

    allowed_node_uids = {str(item["uid"]) for item in mindmap_nodes}
    allowed_question_ids: set[int] = set()
    for item in questions:
        qid = _coerce_int(item.get("id"))
        if qid is not None:
            allowed_question_ids.add(qid)
    if not allowed_question_ids:
        raise PalaceQuizValidationError("没有可分析的题目。")

    system_prompt = (
        ai_options.prompt_override.strip()
        if ai_options and ai_options.prompt_override and ai_options.prompt_override.strip()
        else ai_dependencies.prompts.render(PROMPT_KEY)
    )

    run_id = (operation_id or str(uuid.uuid4())).strip() or str(uuid.uuid4())
    all_ai_bindings: list[dict[str, Any]] = []
    all_unbound: list[int] = []
    all_warnings: list[str] = []
    batch_logs: list[dict[str, Any]] = []
    size = max(1, min(int(batch_size or DEFAULT_BATCH_SIZE), 80))
    total_batches = (len(questions) + size - 1) // size

    for batch_index in range(total_batches):
        batch = questions[batch_index * size : (batch_index + 1) * size]
        batch_question_ids: set[int] = set()
        for item in batch:
            qid = _coerce_int(item.get("id"))
            if qid is not None:
                batch_question_ids.add(qid)
        model_input = {
            "palace": {"id": palace.id, "title": palace.title},
            "mindmap_nodes": mindmap_nodes,
            "questions": [_question_payload_for_binding(item) for item in batch],
            "instructions": {
                "max_nodes_per_question": MAX_BINDINGS_PER_QUESTION,
                "only_use_provided_uids_and_ids": True,
            },
        }
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
        ]
        config, extra_payload, resolved_ai = _ai._build_chat_config(
            session,
            ai_runtime=ai_dependencies.runtime,
            scenario_key=SCENARIO_KEY,
            ai_options=ai_options,
            temperature=0.2,
            timeout_seconds=120,
        )
        request_payload = {
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "resolved_ai": resolved_ai,
            "batch_index": batch_index,
            "batch_total": total_batches,
            "operation_id": run_id,
        }
        response_text, log_id = _ai._call_logged_chat_completion(
            config=config,
            extra_payload=extra_payload,
            feature="宫殿做题",
            operation=PROMPT_KEY,
            palace_id=palace_id,
            messages=messages,
            response_format={"type": "json_object"},
            request_payload=request_payload,
        )
        bindings, unbound, warnings = _parse_binding_response(
            response_text,
            allowed_question_ids=batch_question_ids,
            allowed_node_uids=allowed_node_uids,
        )
        all_ai_bindings.extend(bindings)
        all_unbound.extend(unbound)
        all_warnings.extend(warnings)
        batch_logs.append(
            {
                "batch_index": batch_index,
                "batch_total": total_batches,
                "question_count": len(batch),
                "binding_count": len(bindings),
                "ai_call_log_id": log_id,
                "resolved_ai": resolved_ai,
            }
        )

    existing_edges = _existing_binding_edges(session, palace_id)
    merged = _merge_preview_bindings(
        ai_bindings=all_ai_bindings,
        existing_edges=existing_edges,
        merge_mode=merge_mode,
    )
    # Deduplicate unbound while preserving order
    seen_unbound: set[int] = set()
    unbound_unique: list[int] = []
    for qid in all_unbound:
        if qid in seen_unbound:
            continue
        # Only report unbound if final merge has no edge for that question
        if any(int(edge["question_id"]) == qid for edge in merged):
            continue
        seen_unbound.add(qid)
        unbound_unique.append(qid)

    return {
        "palace_id": palace_id,
        "operation_id": run_id,
        "merge_mode": merge_mode,
        "mindmap_node_count": len(mindmap_nodes),
        "question_count": len(questions),
        "batch_count": total_batches,
        "batches": batch_logs,
        "bindings": merged,
        "ai_bindings": all_ai_bindings,
        "unbound_question_ids": unbound_unique,
        "warnings": all_warnings[:100],
        "existing_edge_count": len(existing_edges),
        "preview_edge_count": len(merged),
    }



__all__ = [
    "_merge_preview_bindings",
    "_parse_binding_response",
    "preview_quiz_node_binding",
]
