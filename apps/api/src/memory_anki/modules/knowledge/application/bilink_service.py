from __future__ import annotations

import json
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import NodeConnection, Palace
from memory_anki.modules.mindmap.application.editor_state_documents import (
    NODE_UID_KEY,
    build_palace_editor_doc,
    deserialize_editor_payload,
    normalize_editor_doc,
)

BILINK_STYLE = "bilink"
PALACE_NODE_TYPE = "palace"
LABEL_MAX_LENGTH = 200
DISPLAY_TEXT_MAX_LENGTH = 80


def parse_bilink_label(raw: str | None) -> dict[str, str | None]:
    fallback = {"src_uid": None, "tgt_uid": None, "text": ""}
    if not raw:
        return fallback
    try:
        parsed = json.loads(raw)
    except Exception:
        return {"src_uid": None, "tgt_uid": None, "text": str(raw)}
    if not isinstance(parsed, dict):
        return fallback
    return {
        "src_uid": _clean_uid(parsed.get("src_uid")),
        "tgt_uid": _clean_uid(parsed.get("tgt_uid")),
        "text": _clean_text(parsed.get("text")),
    }


def serialize_bilink_label(
    src_uid: str | None,
    tgt_uid: str | None,
    text: str,
) -> str:
    next_text = _clean_text(text)[:DISPLAY_TEXT_MAX_LENGTH]
    payload = {
        "src_uid": _clean_uid(src_uid),
        "tgt_uid": _clean_uid(tgt_uid),
        "text": next_text,
    }
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    while len(serialized) > LABEL_MAX_LENGTH and payload["text"]:
        payload["text"] = payload["text"][:-1]
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) > LABEL_MAX_LENGTH:
        payload["text"] = ""
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return serialized


def search_nodes(session: Session, query: str, limit: int = 20) -> dict[str, list[dict[str, Any]]]:
    needle = query.strip().lower()
    if not needle:
        return {"results": []}

    results: list[dict[str, Any]] = []
    palace_cache: dict[int, dict[str, Any]] = {}
    palaces = session.query(Palace).order_by(Palace.updated_at.desc(), Palace.id.asc()).all()
    for palace in palaces:
        palace_title = (palace.title or "未命名宫殿").strip() or "未命名宫殿"
        if needle in palace_title.lower():
            results.append(
                {
                    "type": "palace",
                    "palace_id": palace.id,
                    "palace_title": palace_title,
                    "node_uid": None,
                    "node_text": None,
                    "node_path": None,
                    "_sort": (
                        1,
                        0 if palace_title.lower().startswith(needle) else 1,
                        len(palace_title),
                        palace.id,
                    ),
                }
            )

        palace_index = palace_cache.setdefault(palace.id, build_palace_doc_index(palace))
        for node in palace_index["ordered_nodes"]:
            node_text = str(node["text"])
            if not node_text or needle not in node_text.lower():
                continue
            results.append(
                {
                    "type": "node",
                    "palace_id": palace.id,
                    "palace_title": palace_title,
                    "node_uid": node["uid"],
                    "node_text": node_text,
                    "node_path": list(node["path"]),
                    "_sort": (
                        0,
                        0 if node_text.lower().startswith(needle) else 1,
                        len(node["path"]),
                        len(node_text),
                        palace.id,
                    ),
                }
            )

    results.sort(key=lambda item: item["_sort"])
    trimmed = results[: max(1, min(limit, 100))]
    for item in trimmed:
        item.pop("_sort", None)
    return {"results": trimmed}


def list_bilinks(session: Session, palace_id: int) -> dict[str, list[dict[str, Any]]]:
    items = (
        session.query(NodeConnection)
        .filter(
            NodeConnection.style == BILINK_STYLE,
            NodeConnection.source_type == PALACE_NODE_TYPE,
            NodeConnection.target_type == PALACE_NODE_TYPE,
            or_(
                NodeConnection.source_id == palace_id,
                NodeConnection.target_id == palace_id,
            ),
        )
        .order_by(NodeConnection.id.desc())
        .all()
    )
    palace_ids = {
        conn.source_id
        for conn in items
    } | {
        conn.target_id
        for conn in items
    }
    palaces = (
        session.query(Palace)
        .filter(Palace.id.in_(palace_ids))
        .all()
        if palace_ids
        else []
    )
    palace_map = {palace.id: palace for palace in palaces}
    palace_indexes = {palace.id: build_palace_doc_index(palace) for palace in palaces}
    return {
        "items": [
            bilink_json(
                conn,
                palace_map=palace_map,
                palace_indexes=palace_indexes,
                focus_palace_id=palace_id,
            )
            for conn in items
        ]
    }


def get_bilink_counts(session: Session, palace_id: int) -> dict[str, dict[str, int]]:
    counts: dict[str, int] = {}
    items = (
        session.query(NodeConnection)
        .filter(
            NodeConnection.style == BILINK_STYLE,
            NodeConnection.target_type == PALACE_NODE_TYPE,
            NodeConnection.target_id == palace_id,
        )
        .all()
    )
    for conn in items:
        label = parse_bilink_label(conn.label)
        target_uid = label["tgt_uid"]
        if not target_uid:
            continue
        counts[target_uid] = counts.get(target_uid, 0) + 1
    return {"counts": counts}


def get_node_context(
    session: Session,
    palace_id: int,
    node_uid: str | None,
) -> dict[str, Any] | None:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return None
    palace_index = build_palace_doc_index(palace)
    palace_title = str(palace_index["palace_title"])

    normalized_uid = _clean_uid(node_uid)
    if not normalized_uid:
        return {
            "palace_id": palace.id,
            "palace_title": palace_title,
            "node_uid": None,
            "node_text": palace_title,
            "node_note": "",
            "node_path": [palace_title],
            "parent_text": None,
            "children": list(palace_index["root_children"]),
            "siblings": [],
        }

    node = palace_index["nodes"].get(normalized_uid)
    if not node:
        return None
    return {
        "palace_id": palace.id,
        "palace_title": palace_title,
        "node_uid": node["uid"],
        "node_text": node["text"],
        "node_note": node["note"],
        "node_path": list(node["path"]),
        "parent_text": node["parent_text"],
        "children": list(node["children"]),
        "siblings": list(node["siblings"]),
    }


def create_bilink(
    session: Session,
    *,
    source_palace_id: int,
    target_palace_id: int,
    src_uid: str | None,
    tgt_uid: str | None,
    text: str,
) -> NodeConnection:
    source_palace = session.query(Palace).filter_by(id=source_palace_id).first()
    target_palace = session.query(Palace).filter_by(id=target_palace_id).first()
    if not source_palace or not target_palace:
        raise ValueError("来源宫殿或目标宫殿不存在。")

    source_index = build_palace_doc_index(source_palace)
    target_index = build_palace_doc_index(target_palace)
    normalized_src_uid = _clean_uid(src_uid)
    normalized_tgt_uid = _clean_uid(tgt_uid)

    if (
        source_palace_id == target_palace_id
        and normalized_src_uid == normalized_tgt_uid
    ):
        raise ValueError("不能给同一个节点创建自引用双向链接。")

    if normalized_src_uid and normalized_src_uid not in source_index["nodes"]:
        raise ValueError("来源节点不存在。")
    if normalized_tgt_uid and normalized_tgt_uid not in target_index["nodes"]:
        raise ValueError("目标节点不存在。")

    display_text = _clean_text(text)
    if not display_text:
        display_text = (
            target_index["nodes"].get(normalized_tgt_uid, {}).get("text")
            if normalized_tgt_uid
            else target_index["palace_title"]
        )
        display_text = _clean_text(display_text)
    if not display_text:
        display_text = "关联宫殿"

    existing = find_existing_bilink(
        session,
        source_palace_id=source_palace_id,
        target_palace_id=target_palace_id,
        src_uid=normalized_src_uid,
        tgt_uid=normalized_tgt_uid,
    )
    if existing:
        return existing

    conn = NodeConnection(
        source_type=PALACE_NODE_TYPE,
        source_id=source_palace_id,
        target_type=PALACE_NODE_TYPE,
        target_id=target_palace_id,
        label=serialize_bilink_label(normalized_src_uid, normalized_tgt_uid, display_text),
        style=BILINK_STYLE,
    )
    session.add(conn)
    session.flush()
    return conn


def delete_bilink(session: Session, bilink_id: int) -> bool:
    conn = (
        session.query(NodeConnection)
        .filter(
            NodeConnection.id == bilink_id,
            NodeConnection.style == BILINK_STYLE,
        )
        .first()
    )
    if not conn:
        return False
    session.delete(conn)
    session.flush()
    return True


def bilink_json(
    conn: NodeConnection,
    *,
    palace_map: dict[int, Palace],
    palace_indexes: dict[int, dict[str, Any]],
    focus_palace_id: int | None = None,
) -> dict[str, Any]:
    label = parse_bilink_label(conn.label)
    source_palace = palace_map.get(conn.source_id)
    target_palace = palace_map.get(conn.target_id)
    source_index = palace_indexes.get(conn.source_id)
    target_index = palace_indexes.get(conn.target_id)
    source_node = (
        source_index["nodes"].get(label["src_uid"])
        if source_index and label["src_uid"]
        else None
    )
    target_node = (
        target_index["nodes"].get(label["tgt_uid"])
        if target_index and label["tgt_uid"]
        else None
    )
    return {
        "id": conn.id,
        "direction":
            "outgoing"
            if focus_palace_id is not None and conn.source_id == focus_palace_id
            else "incoming"
            if focus_palace_id is not None and conn.target_id == focus_palace_id
            else None,
        "source_palace_id": conn.source_id,
        "source_palace_title": source_index["palace_title"]
        if source_index
        else (source_palace.title if source_palace else ""),
        "target_palace_id": conn.target_id,
        "target_palace_title": target_index["palace_title"]
        if target_index
        else (target_palace.title if target_palace else ""),
        "src_uid": label["src_uid"],
        "tgt_uid": label["tgt_uid"],
        "text": label["text"],
        "source_node_text": source_node["text"] if source_node else None,
        "target_node_text": target_node["text"] if target_node else None,
        "source_node_path": list(source_node["path"]) if source_node else None,
        "target_node_path": list(target_node["path"]) if target_node else None,
    }


def build_palace_doc_index(palace: Palace) -> dict[str, Any]:
    doc = deserialize_editor_payload(palace.editor_doc, None)
    if not isinstance(doc, dict):
        doc = build_palace_editor_doc(palace)
    doc = normalize_editor_doc(doc, root_text=palace.title, root_kind="palace")
    root = doc.get("root") if isinstance(doc.get("root"), dict) else {}
    palace_title = _clean_text((root.get("data") or {}).get("text") or palace.title or "未命名宫殿")
    ordered_nodes: list[dict[str, Any]] = []
    nodes: dict[str, dict[str, Any]] = {}

    def summarize(node: Any) -> dict[str, str]:
        data = node.get("data") if isinstance(node, dict) and isinstance(node.get("data"), dict) else {}
        return {
            "uid": _clean_uid(data.get(NODE_UID_KEY)) or "",
            "text": _clean_text(data.get("text")) or "未命名节点",
        }

    def walk(node: Any, parent_text: str | None, path_prefix: list[str], siblings: list[Any]) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = _clean_uid(data.get(NODE_UID_KEY))
        if not uid:
            return
        text = _clean_text(data.get("text")) or "未命名节点"
        note = _clean_text(data.get("note"))
        children = node.get("children") if isinstance(node.get("children"), list) else []
        path = [*path_prefix, text]
        entry = {
            "uid": uid,
            "text": text,
            "note": note,
            "path": path,
            "parent_text": parent_text,
            "children": [
                child_summary
                for child_summary in (summarize(child) for child in children)
                if child_summary["uid"]
            ],
            "siblings": [
                sibling_summary
                for sibling_summary in (summarize(sibling) for sibling in siblings)
                if sibling_summary["uid"] and sibling_summary["uid"] != uid
            ],
        }
        nodes[uid] = entry
        ordered_nodes.append(entry)
        for child in children:
            walk(child, text, path, children)

    root_children = root.get("children") if isinstance(root.get("children"), list) else []
    for child in root_children:
        walk(child, palace_title, [palace_title], root_children)

    return {
        "palace_id": palace.id,
        "palace_title": palace_title,
        "nodes": nodes,
        "ordered_nodes": ordered_nodes,
        "root_children": [
            child_summary
            for child_summary in (summarize(child) for child in root_children)
            if child_summary["uid"]
        ],
    }


def find_existing_bilink(
    session: Session,
    *,
    source_palace_id: int,
    target_palace_id: int,
    src_uid: str | None,
    tgt_uid: str | None,
) -> NodeConnection | None:
    items = (
        session.query(NodeConnection)
        .filter(
            NodeConnection.style == BILINK_STYLE,
            NodeConnection.source_type == PALACE_NODE_TYPE,
            NodeConnection.target_type == PALACE_NODE_TYPE,
            or_(
                and_(
                    NodeConnection.source_id == source_palace_id,
                    NodeConnection.target_id == target_palace_id,
                ),
                and_(
                    NodeConnection.source_id == target_palace_id,
                    NodeConnection.target_id == source_palace_id,
                ),
            ),
        )
        .all()
    )
    normalized_src_uid = _clean_uid(src_uid)
    normalized_tgt_uid = _clean_uid(tgt_uid)
    for conn in items:
        label = parse_bilink_label(conn.label)
        if (
            conn.source_id == source_palace_id
            and conn.target_id == target_palace_id
            and label["src_uid"] == normalized_src_uid
            and label["tgt_uid"] == normalized_tgt_uid
        ):
            return conn
        if (
            conn.source_id == target_palace_id
            and conn.target_id == source_palace_id
            and label["src_uid"] == normalized_tgt_uid
            and label["tgt_uid"] == normalized_src_uid
        ):
            return conn
    return None


def _clean_uid(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_text(value: Any) -> str:
    return str(value or "").strip()
