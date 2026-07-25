"""Bind palace quiz questions to mind-map node UIDs via AI analysis."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.content.public.queries import resolve_palace_title
from memory_anki.modules.mindmap_document.api import collect_node_descendants

from .generation.shared import node_children, node_text
from .questions.queries import get_palace_or_raise, get_question_or_raise

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


def _serialize_binding(
    row: PalaceQuizQuestionNodeBinding,
    *,
    question: PalaceQuizQuestion | None = None,
    owner_title: str | None = None,
    target_title: str | None = None,
    node_text_label: str | None = None,
) -> dict[str, object]:
    owner_palace_id = int(question.palace_id) if question and question.palace_id is not None else None
    target_palace_id = int(row.palace_id) if row.palace_id is not None else None
    is_cross = (
        owner_palace_id is not None
        and target_palace_id is not None
        and owner_palace_id != target_palace_id
    )
    return {
        "id": row.id,
        "palace_id": target_palace_id,
        "target_palace_id": target_palace_id,
        "target_palace_title": target_title or "",
        "question_id": row.question_id,
        "question_owner_palace_id": owner_palace_id,
        "question_owner_palace_title": owner_title or "",
        "is_cross_palace": is_cross,
        "node_uid": row.node_uid,
        "node_text": node_text_label or "",
        "confidence": row.confidence,
        "reason": row.reason or "",
        "source": row.source,
        "run_id": row.run_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _palace_title_map(session: Session, palace_ids: set[int]) -> dict[int, str]:
    if not palace_ids:
        return {}
    rows = session.query(Palace).filter(Palace.id.in_(sorted(palace_ids))).all()
    return {int(row.id): resolve_palace_title(row) for row in rows if row.id is not None}


def _node_label_map(session: Session, palace_id: int) -> dict[str, str]:
    palace = get_palace_or_raise(session, palace_id)
    _descendants, labels = collect_node_descendants(getattr(palace, "editor_doc", None))
    return {str(uid): str(text or uid) for uid, text in (labels or {}).items()}


def list_palace_node_bindings(session: Session, palace_id: int) -> list[dict[str, object]]:
    """List edges whose **target** mindmap node lives on this palace (reverse index)."""
    get_palace_or_raise(session, palace_id)
    rows = (
        session.query(PalaceQuizQuestionNodeBinding, PalaceQuizQuestion)
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
    owner_ids = {
        int(question.palace_id)
        for _row, question in rows
        if question.palace_id is not None
    }
    titles = _palace_title_map(session, owner_ids | {palace_id})
    node_labels = _node_label_map(session, palace_id)
    target_title = titles.get(palace_id, "")
    return [
        _serialize_binding(
            row,
            question=question,
            owner_title=titles.get(int(question.palace_id)) if question.palace_id else "",
            target_title=target_title,
            node_text_label=node_labels.get(str(row.node_uid), ""),
        )
        for row, question in rows
    ]


def list_question_node_bindings(session: Session, question_id: int) -> list[dict[str, object]]:
    """List all target-node edges for one question (quiz → 知识点)."""
    question = get_question_or_raise(session, question_id)
    rows = (
        session.query(PalaceQuizQuestionNodeBinding)
        .filter(PalaceQuizQuestionNodeBinding.question_id == question_id)
        .order_by(
            PalaceQuizQuestionNodeBinding.palace_id.asc(),
            PalaceQuizQuestionNodeBinding.node_uid.asc(),
        )
        .all()
    )
    target_ids = {int(row.palace_id) for row in rows if row.palace_id is not None}
    owner_ids = {int(question.palace_id)} if question.palace_id is not None else set()
    titles = _palace_title_map(session, target_ids | owner_ids)
    owner_title = titles.get(int(question.palace_id), "") if question.palace_id else ""
    # Cache node labels per target palace
    label_cache: dict[int, dict[str, str]] = {}
    items: list[dict[str, object]] = []
    for row in rows:
        target_id = int(row.palace_id)
        if target_id not in label_cache:
            try:
                label_cache[target_id] = _node_label_map(session, target_id)
            except Exception:  # pragma: no cover - missing palace edge case
                label_cache[target_id] = {}
        items.append(
            _serialize_binding(
                row,
                question=question,
                owner_title=owner_title,
                target_title=titles.get(target_id, ""),
                node_text_label=label_cache[target_id].get(str(row.node_uid), ""),
            )
        )
    return items


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

    # AI apply writes edges for questions owned by this palace onto this palace's mindmap
    # (target palace_id == path palace). Cross-palace edges use mutate / question-side pick.
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
    known_uids = set(descendants.keys())

    if merge_mode == "replace_all":
        session.query(PalaceQuizQuestionNodeBinding).filter(
            PalaceQuizQuestionNodeBinding.palace_id == palace_id,
            PalaceQuizQuestionNodeBinding.source == "ai",
        ).delete(synchronize_session=False)

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
                PalaceQuizQuestionNodeBinding.palace_id == palace_id,
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
    """Manually add/remove edges whose default target palace is ``palace_id``.

    Adds may bind any active question (including foreign-owner) onto a node in
    the target palace. Each add item may override ``target_palace_id`` / ``palace_id``
    for cross-palace authoring from the question side.
    """
    get_palace_or_raise(session, palace_id)

    remove_rows = remove or []
    add_rows = add or []
    removed = 0
    for item in remove_rows:
        if not isinstance(item, dict):
            continue
        try:
            question_id = int(item["question_id"])
            node_uid = str(item.get("node_uid") or "").strip()
            raw_target = item.get("target_palace_id")
            if raw_target is None:
                raw_target = item.get("palace_id")
            target_palace_id = int(raw_target) if raw_target is not None else int(palace_id)
        except (TypeError, ValueError, KeyError):
            continue
        if not node_uid:
            continue
        deleted = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(
                PalaceQuizQuestionNodeBinding.palace_id == target_palace_id,
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
                PalaceQuizQuestion.deleted_at.is_(None),
                PalaceQuizQuestion.id.in_(question_ids),
            )
            .all()
        }
    else:
        active_ids = set()

    known_uids_by_palace: dict[int, set[str]] = {}

    def _known_uids(target_id: int) -> set[str]:
        if target_id not in known_uids_by_palace:
            target_palace = get_palace_or_raise(session, target_id)
            descendants, _labels = collect_node_descendants(
                getattr(target_palace, "editor_doc", None)
            )
            known_uids_by_palace[target_id] = set(descendants.keys())
        return known_uids_by_palace[target_id]

    now = utc_now_naive()
    created = 0
    updated = 0
    for item in add_rows:
        if not isinstance(item, dict):
            continue
        try:
            question_id = int(item["question_id"])
            node_uid = str(item.get("node_uid") or "").strip()
            raw_target = item.get("target_palace_id")
            if raw_target is None:
                raw_target = item.get("palace_id")
            target_palace_id = int(raw_target) if raw_target is not None else int(palace_id)
        except (TypeError, ValueError, KeyError):
            continue
        if question_id not in active_ids or not node_uid:
            continue
        known_uids = _known_uids(target_palace_id)
        if known_uids and node_uid not in known_uids:
            continue
        reason = str(item.get("reason") or "手动绑定")[:500]
        exists = (
            session.query(PalaceQuizQuestionNodeBinding)
            .filter(
                PalaceQuizQuestionNodeBinding.palace_id == target_palace_id,
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
                palace_id=target_palace_id,
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


from .node_binding_ai import (  # noqa: E402
    _merge_preview_bindings,
    _parse_binding_response,
    preview_quiz_node_binding,
)
from .node_binding_ops import (  # noqa: E402
    auto_bind_palace_questions_by_text,
    search_mindmap_nodes,
)

__all__ = [
    "PROMPT_KEY",
    "SCENARIO_KEY",
    "apply_quiz_node_binding_preview",
    "auto_bind_palace_questions_by_text",
    "compact_mindmap_with_uids",
    "list_palace_node_bindings",
    "list_question_node_bindings",
    "mutate_quiz_node_bindings",
    "preview_quiz_node_binding",
    "search_mindmap_nodes",
    "_merge_preview_bindings",
    "_parse_binding_response",
]

