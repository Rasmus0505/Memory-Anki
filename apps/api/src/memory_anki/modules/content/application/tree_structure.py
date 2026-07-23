"""Stable palace mind-map tree projections for cross-context consumers."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace


def _node_uid(raw: dict[str, Any], fallback: str) -> str:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    return str(data.get("uid") or data.get("memoryAnkiId") or fallback).strip()


def _node_text(raw: dict[str, Any]) -> str:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    return str(data.get("text") or "").strip()


def _node_anki_fields(raw: dict[str, Any]) -> dict[str, Any]:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    role = data.get("ankiRole")
    safe_role = role if role in {"front", "back", "none"} else None
    front_uid = str(data.get("ankiFrontUid") or "").strip() or None
    fields: dict[str, Any] = {}
    if safe_role is not None:
        fields["anki_role"] = safe_role
    if front_uid:
        fields["anki_front_uid"] = front_uid
    return fields


def build_tree_from_editor_doc(editor_doc: Any) -> tuple[str | None, dict[str, dict[str, Any]]]:
    """Return (root_uid, nodes) with children ordered as stored in the document."""
    document = editor_doc
    if isinstance(editor_doc, str):
        try:
            document = json.loads(editor_doc or "{}")
        except (TypeError, ValueError):
            return None, {}
    root = document.get("root") if isinstance(document, dict) else None
    if not isinstance(root, dict):
        return None, {}

    result: dict[str, dict[str, Any]] = {}

    def walk(raw: dict[str, Any], parent_uid: str | None, fallback: str) -> str:
        uid = _node_uid(raw, fallback)
        value = raw.get("children")
        children_raw: list[Any] = value if isinstance(value, list) else []
        children = [
            walk(child, uid, f"{fallback}-{index}")
            for index, child in enumerate(children_raw)
            if isinstance(child, dict)
        ]
        result[uid] = {
            "uid": uid,
            "parent_uid": parent_uid,
            "children": children,
            "text": _node_text(raw),
            **_node_anki_fields(raw),
        }
        return uid

    root_uid = walk(root, None, "root")
    return root_uid, result


def stable_tree_order(
    nodes: dict[str, dict[str, Any]],
    *,
    root_uid: str | None,
) -> list[str]:
    """Depth-first pre-order excluding the palace root."""
    if not root_uid or root_uid not in nodes:
        return []
    order: list[str] = []
    stack = list(reversed(list(nodes[root_uid].get("children") or [])))
    while stack:
        uid = stack.pop()
        if uid not in nodes:
            continue
        order.append(uid)
        children = list(nodes[uid].get("children") or [])
        stack.extend(reversed(children))
    return order


def subtree_node_uids(
    nodes: dict[str, dict[str, Any]],
    branch_uid: str,
    *,
    include_self: bool = True,
) -> list[str]:
    """Depth-first list of nodes in a branch (optionally including the branch root)."""
    if branch_uid not in nodes:
        return []
    result: list[str] = [branch_uid] if include_self else []
    stack = list(nodes[branch_uid].get("children") or [])
    while stack:
        current = stack.pop(0)
        if current not in nodes:
            continue
        result.append(current)
        stack[0:0] = list(nodes[current].get("children") or [])
    return result


def ancestor_path(
    nodes: dict[str, dict[str, Any]],
    uid: str,
    *,
    stop_at: str | None = None,
) -> list[dict[str, str]]:
    """Root-to-parent path for readonly context (does not include ``uid``)."""
    path: list[dict[str, str]] = []
    current = nodes.get(uid, {}).get("parent_uid")
    while current and current in nodes:
        if stop_at is not None and current == stop_at:
            path.append({"uid": current, "text": str(nodes[current].get("text") or "")})
            break
        path.append({"uid": current, "text": str(nodes[current].get("text") or "")})
        current = nodes[current].get("parent_uid")
    path.reverse()
    return path


def get_palace_tree_structure(session: Session, palace_id: int) -> dict[str, Any]:
    palace = (
        session.query(Palace)
        .filter(
            Palace.id == palace_id,
            Palace.archived == False,  # noqa: E712
            Palace.deleted_at.is_(None),
        )
        .first()
    )
    if palace is None:
        raise ValueError(f"palace not found: {palace_id}")
    root_uid, nodes = build_tree_from_editor_doc(palace.editor_doc)
    order = stable_tree_order(nodes, root_uid=root_uid)
    return {
        "palace_id": palace.id,
        "title": palace.title or "",
        "root_uid": root_uid,
        "nodes": nodes,
        "stable_order": order,
        "node_count": len(order),
    }


def list_active_palace_tree_structures(
    session: Session,
    *,
    palace_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    query = session.query(Palace).filter(
        Palace.archived == False,  # noqa: E712
        Palace.deleted_at.is_(None),
    )
    if palace_ids is not None:
        if not palace_ids:
            return []
        query = query.filter(Palace.id.in_(palace_ids))
    palaces = query.order_by(Palace.group_sort_order.asc(), Palace.id.asc()).all()
    result: list[dict[str, Any]] = []
    for palace in palaces:
        root_uid, nodes = build_tree_from_editor_doc(palace.editor_doc)
        order = stable_tree_order(nodes, root_uid=root_uid)
        result.append(
            {
                "palace_id": palace.id,
                "title": palace.title or "",
                "root_uid": root_uid,
                "nodes": nodes,
                "stable_order": order,
                "node_count": len(order),
            }
        )
    return result


__all__ = [
    "ancestor_path",
    "build_tree_from_editor_doc",
    "get_palace_tree_structure",
    "list_active_palace_tree_structures",
    "stable_tree_order",
    "subtree_node_uids",
]
