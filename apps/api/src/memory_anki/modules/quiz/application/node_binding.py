"""Bind palace quiz questions to mind-map node UIDs via AI analysis."""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import (
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.mindmap_document.api import collect_node_descendants
from memory_anki.platform.application import AiRuntimeOptions, extract_first_json_object

from . import ai_service as _ai
from ._question_utils import PalaceQuizAiError
from .ai_dependencies import PalaceQuizAiDependencies
from .generation.shared import node_children, node_text
from .question_contracts import PalaceQuizValidationError
from .question_schema import serialize_question_rows
from .questions.queries import get_palace_or_raise, list_root_question_rows

DEFAULT_BATCH_SIZE = 30
MAX_NODES_FOR_PROMPT = 200
MAX_BINDINGS_PER_QUESTION = 8
MergeMode = Literal["replace_all", "fill_unbound"]

PROMPT_KEY = "ai_prompt_palace_quiz_node_binding"
SCENARIO_KEY = "quiz_node_binding"


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError:
            return None
    return None


def compact_mindmap_with_uids(editor_doc: Any, *, max_nodes: int = MAX_NODES_FOR_PROMPT) -> list[dict[str, Any]]:
    """Flatten mindmap into a list of {uid, text, parent_uid, depth} for AI prompts."""
    root = (editor_doc or {}).get("root") if isinstance(editor_doc, dict) else None
    if not isinstance(root, dict):
        from memory_anki.modules.mindmap_document.api import deserialize_editor_payload

        doc = deserialize_editor_payload(editor_doc, {})
        root = doc.get("root") if isinstance(doc, dict) else None
    nodes: list[dict[str, Any]] = []

    def walk(node: Any, parent_uid: str | None, depth: int) -> None:
        if not isinstance(node, dict) or len(nodes) >= max_nodes:
            return
        raw_data = node.get("data")
        data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
        uid = str(data.get("uid") or "").strip()
        text = node_text(node) or uid
        if uid:
            nodes.append(
                {
                    "uid": uid,
                    "text": text[:240],
                    "parent_uid": parent_uid,
                    "depth": depth,
                }
            )
        for child in node_children(node):
            walk(child, uid or parent_uid, depth + 1)

    walk(root, None, 0)
    return nodes


def _serialize_binding(row: PalaceQuizQuestionNodeBinding) -> dict[str, object]:
    return {
        "id": row.id,
        "palace_id": row.palace_id,
        "question_id": row.question_id,
        "node_uid": row.node_uid,
        "confidence": row.confidence,
        "reason": row.reason or "",
        "source": row.source,
        "run_id": row.run_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_palace_node_bindings(session: Session, palace_id: int) -> list[dict[str, object]]:
    get_palace_or_raise(session, palace_id)
    rows = (
        session.query(PalaceQuizQuestionNodeBinding)
        .join(
            PalaceQuizQuestion,
            PalaceQuizQuestion.id == PalaceQuizQuestionNodeBinding.question_id,
        )
        .filter(
            PalaceQuizQuestionNodeBinding.palace_id == palace_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .order_by(
            PalaceQuizQuestionNodeBinding.question_id.asc(),
            PalaceQuizQuestionNodeBinding.node_uid.asc(),
        )
        .all()
    )
    return [_serialize_binding(row) for row in rows]


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


def _existing_binding_edges(session: Session, palace_id: int) -> list[tuple[int, str]]:
    rows = (
        session.query(
            PalaceQuizQuestionNodeBinding.question_id,
            PalaceQuizQuestionNodeBinding.node_uid,
        )
        .join(
            PalaceQuizQuestion,
            PalaceQuizQuestion.id == PalaceQuizQuestionNodeBinding.question_id,
        )
        .filter(
            PalaceQuizQuestionNodeBinding.palace_id == palace_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    return [(int(question_id), str(node_uid)) for question_id, node_uid in rows]


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


def apply_quiz_node_binding_preview(
    session: Session,
    *,
    palace_id: int,
    merge_mode: MergeMode,
    bindings: list[dict[str, Any]],
    operation_id: str | None = None,
    accepted_edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Persist preview edges. When accepted_edges is provided, only those are written."""
    palace = get_palace_or_raise(session, palace_id)
    run_id = (operation_id or str(uuid.uuid4())).strip() or str(uuid.uuid4())
    source_rows = accepted_edges if accepted_edges is not None else bindings

    # Validate question ids belong to palace and are active
    question_ids = {
        int(item["question_id"])
        for item in source_rows
        if isinstance(item, dict) and item.get("question_id") is not None
    }
    if question_ids:
        active_ids = {
            int(row.id)
            for row in session.query(PalaceQuizQuestion.id)
            .filter(
                PalaceQuizQuestion.palace_id == palace_id,
                PalaceQuizQuestion.deleted_at.is_(None),
                PalaceQuizQuestion.id.in_(question_ids),
            )
            .all()
        }
    else:
        active_ids = set()

    descendants, _labels = collect_node_descendants(getattr(palace, "editor_doc", None))
    # Prefer known node uids from document; if empty, still accept provided uids from preview
    known_uids = set(descendants.keys())

    if merge_mode == "replace_all":
        session.query(PalaceQuizQuestionNodeBinding).filter(
            PalaceQuizQuestionNodeBinding.palace_id == palace_id,
            PalaceQuizQuestionNodeBinding.source == "ai",
        ).delete(synchronize_session=False)
        # Also clear any existing edges for questions we are about to rewrite from AI preview
        # (manual edges kept only if source != ai and not in replace_all of those questions)
        # Product: replace_all clears AI bindings; manual kept. Re-insert accepted AI edges.

    edges_to_write: list[dict[str, Any]] = []
    for item in source_rows:
        if not isinstance(item, dict):
            continue
        try:
            question_id = int(item["question_id"])
            node_uid = str(item.get("node_uid") or "").strip()
        except (TypeError, ValueError, KeyError):
            continue
        if question_id not in active_ids or not node_uid:
            continue
        if known_uids and node_uid not in known_uids:
            continue
        if item.get("source") == "existing" and merge_mode == "fill_unbound":
            # already in DB; skip re-insert
            continue
        edges_to_write.append(
            {
                "question_id": question_id,
                "node_uid": node_uid,
                "reason": str(item.get("reason") or "")[:500],
                "confidence": item.get("confidence"),
                "source": "ai" if item.get("source") != "manual" else "manual",
            }
        )

    if merge_mode == "fill_unbound":
        existing = {
            (int(q), str(n))
            for q, n in _existing_binding_edges(session, palace_id)
        }
        edges_to_write = [
            edge
            for edge in edges_to_write
            if (int(edge["question_id"]), str(edge["node_uid"])) not in existing
        ]

    now = utc_now_naive()
    created = 0
    for edge in edges_to_write:
        exists = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(
                PalaceQuizQuestionNodeBinding.question_id == edge["question_id"],
                PalaceQuizQuestionNodeBinding.node_uid == edge["node_uid"],
            )
            .first()
        )
        if exists:
            exists.reason = edge["reason"]
            exists.confidence = edge["confidence"]
            exists.source = edge["source"]
            exists.run_id = run_id
            exists.updated_at = now
            continue
        session.add(
            PalaceQuizQuestionNodeBinding(
                palace_id=palace_id,
                question_id=edge["question_id"],
                node_uid=edge["node_uid"],
                reason=edge["reason"],
                confidence=edge["confidence"],
                source=edge["source"],
                run_id=run_id,
                created_at=now,
                updated_at=now,
            )
        )
        created += 1

    session.commit()
    items = list_palace_node_bindings(session, palace_id)
    return {
        "palace_id": palace_id,
        "operation_id": run_id,
        "merge_mode": merge_mode,
        "created_count": created,
        "items": items,
        "item_count": len(items),
    }


def mutate_quiz_node_bindings(
    session: Session,
    *,
    palace_id: int,
    add: list[dict[str, Any]] | None = None,
    remove: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Manually add/remove question↔node edges (source=manual for adds)."""
    palace = get_palace_or_raise(session, palace_id)
    descendants, _labels = collect_node_descendants(getattr(palace, "editor_doc", None))
    known_uids = set(descendants.keys())

    remove_rows = remove or []
    add_rows = add or []
    removed = 0
    for item in remove_rows:
        if not isinstance(item, dict):
            continue
        try:
            question_id = int(item["question_id"])
            node_uid = str(item.get("node_uid") or "").strip()
        except (TypeError, ValueError, KeyError):
            continue
        if not node_uid:
            continue
        deleted = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(
                PalaceQuizQuestionNodeBinding.palace_id == palace_id,
                PalaceQuizQuestionNodeBinding.question_id == question_id,
                PalaceQuizQuestionNodeBinding.node_uid == node_uid,
            )
            .delete(synchronize_session=False)
        )
        removed += int(deleted or 0)

    question_ids = {
        int(item["question_id"])
        for item in add_rows
        if isinstance(item, dict) and item.get("question_id") is not None
    }
    if question_ids:
        active_ids = {
            int(row.id)
            for row in session.query(PalaceQuizQuestion.id)
            .filter(
                PalaceQuizQuestion.palace_id == palace_id,
                PalaceQuizQuestion.deleted_at.is_(None),
                PalaceQuizQuestion.id.in_(question_ids),
            )
            .all()
        }
    else:
        active_ids = set()

    now = utc_now_naive()
    created = 0
    updated = 0
    for item in add_rows:
        if not isinstance(item, dict):
            continue
        try:
            question_id = int(item["question_id"])
            node_uid = str(item.get("node_uid") or "").strip()
        except (TypeError, ValueError, KeyError):
            continue
        if question_id not in active_ids or not node_uid:
            continue
        if known_uids and node_uid not in known_uids:
            continue
        reason = str(item.get("reason") or "手动绑定")[:500]
        exists = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(
                PalaceQuizQuestionNodeBinding.question_id == question_id,
                PalaceQuizQuestionNodeBinding.node_uid == node_uid,
            )
            .first()
        )
        if exists:
            exists.reason = reason
            exists.source = "manual"
            exists.confidence = None
            exists.updated_at = now
            updated += 1
            continue
        session.add(
            PalaceQuizQuestionNodeBinding(
                palace_id=palace_id,
                question_id=question_id,
                node_uid=node_uid,
                reason=reason,
                confidence=None,
                source="manual",
                run_id=None,
                created_at=now,
                updated_at=now,
            )
        )
        created += 1

    session.commit()
    items = list_palace_node_bindings(session, palace_id)
    return {
        "palace_id": palace_id,
        "created_count": created,
        "updated_count": updated,
        "removed_count": removed,
        "items": items,
        "item_count": len(items),
    }


__all__ = [
    "PROMPT_KEY",
    "SCENARIO_KEY",
    "apply_quiz_node_binding_preview",
    "compact_mindmap_with_uids",
    "list_palace_node_bindings",
    "mutate_quiz_node_bindings",
    "preview_quiz_node_binding",
]
