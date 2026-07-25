"""Extra quiz↔node binding operations: node search and text auto-bind."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.public.queries import resolve_palace_title

from .node_binding import (
    _coerce_int,
    _existing_binding_edges,
    compact_mindmap_with_uids,
    list_palace_node_bindings,
    mutate_quiz_node_bindings,
)
from .question_contracts import PalaceQuizValidationError
from .question_schema import serialize_question_rows
from .questions.queries import get_palace_or_raise, list_root_question_rows


def search_mindmap_nodes(
    session: Session,
    *,
    query: str,
    palace_id: int | None = None,
    limit: int = 30,
) -> list[dict[str, object]]:
    """Search node text across one palace or all active palaces."""
    text = (query or "").strip()
    if not text:
        return []
    limit = max(1, min(int(limit), 80))
    palace_query = session.query(Palace).filter(
        Palace.deleted_at.is_(None),
        Palace.archived.is_(False),
    )
    if palace_id is not None:
        palace_query = palace_query.filter(Palace.id == palace_id)
    palaces = palace_query.order_by(Palace.updated_at.desc(), Palace.id.desc()).limit(200).all()
    needle = text.lower()
    hits: list[dict[str, object]] = []
    for palace in palaces:
        nodes = compact_mindmap_with_uids(getattr(palace, "editor_doc", None), max_nodes=500)
        title = resolve_palace_title(palace)
        for node in nodes:
            node_text_value = str(node.get("text") or "")
            if needle not in node_text_value.lower() and needle not in str(node.get("uid") or "").lower():
                continue
            hits.append(
                {
                    "palace_id": int(palace.id),
                    "palace_title": title,
                    "node_uid": str(node["uid"]),
                    "node_text": node_text_value,
                    "depth": int(node.get("depth") or 0),
                }
            )
            if len(hits) >= limit:
                return hits
    return hits


def auto_bind_palace_questions_by_text(
    session: Session,
    *,
    palace_id: int,
    fill_unbound_only: bool = True,
    max_nodes_per_question: int = 3,
) -> dict[str, Any]:
    """Deterministic text-overlap binder for bulk backfill (no AI)."""
    palace = get_palace_or_raise(session, palace_id)
    nodes = compact_mindmap_with_uids(getattr(palace, "editor_doc", None), max_nodes=400)
    if not nodes:
        raise PalaceQuizValidationError("思维导图为空，无法自动绑定。")
    questions = serialize_question_rows(list_root_question_rows(session, palace_id=palace_id))
    if not questions:
        raise PalaceQuizValidationError("没有可绑定的题目。")

    existing = set(_existing_binding_edges(session, palace_id))
    bound_questions = {qid for qid, _uid in existing} if fill_unbound_only else set()

    def tokens(text: str) -> set[str]:
        raw = (text or "").strip().lower()
        parts = re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9_]{3,}", raw)
        grams: set[str] = set()
        for part in parts:
            grams.add(part)
            if re.fullmatch(r"[\u4e00-\u9fff]+", part) and len(part) >= 2:
                for index in range(len(part) - 1):
                    grams.add(part[index : index + 2])
        return grams

    node_tokens = [
        (str(node["uid"]), str(node.get("text") or ""), tokens(str(node.get("text") or "")))
        for node in nodes
        if str(node.get("uid") or "").strip()
    ]

    add: list[dict[str, Any]] = []
    for question in questions:
        qid = _coerce_int(question.get("id"))
        if qid is None:
            continue
        if fill_unbound_only and qid in bound_questions:
            continue
        q_tokens = tokens(str(question.get("stem") or "")) | tokens(
            str(question.get("analysis") or "")
        )
        if not q_tokens:
            continue
        scored: list[tuple[float, str]] = []
        for uid, node_text_value, n_tokens in node_tokens:
            if not n_tokens:
                continue
            stem = str(question.get("stem") or "")
            if node_text_value and node_text_value in stem:
                scored.append((2.0, uid))
                continue
            overlap = len(q_tokens & n_tokens)
            if overlap <= 0:
                continue
            score = overlap / max(len(n_tokens), 1)
            if score < 0.25:
                continue
            scored.append((score, uid))
        scored.sort(key=lambda item: (-item[0], item[1]))
        for score, uid in scored[: max(1, min(max_nodes_per_question, 8))]:
            if (qid, uid) in existing:
                continue
            add.append(
                {
                    "question_id": qid,
                    "node_uid": uid,
                    "reason": f"auto text-overlap score={score:.2f}",
                }
            )
    if not add:
        items = list_palace_node_bindings(session, palace_id)
        return {
            "palace_id": palace_id,
            "created_count": 0,
            "updated_count": 0,
            "removed_count": 0,
            "items": items,
            "item_count": len(items),
            "proposed_count": 0,
        }
    result = mutate_quiz_node_bindings(session, palace_id=palace_id, add=add, remove=[])
    result["proposed_count"] = len(add)
    return result


__all__ = [
    "auto_bind_palace_questions_by_text",
    "search_mindmap_nodes",
]
