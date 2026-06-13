from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace
from memory_anki.modules.mindmap.application.editor_state_service import (
    NODE_UID_KEY,
    _deserialize,
)


def parse_segment_node_uids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    result: list[str] = []
    for item in data:
        text = str(item or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def serialize_segment_node_uids(node_uids: list[str]) -> str:
    return json.dumps(node_uids, ensure_ascii=False)


def collect_doc_nodes_with_descendants(
    editor_doc: Any,
) -> tuple[dict[str, set[str]], dict[str, str]]:
    doc = _deserialize(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    descendants: dict[str, set[str]] = {}
    labels: dict[str, str] = {}

    def walk(node: Any) -> set[str]:
        if not isinstance(node, dict):
            return set()
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = str(data.get(NODE_UID_KEY) or "").strip()
        text = str(data.get("text") or "").strip()
        child_sets: set[str] = set()
        children = node.get("children") if isinstance(node.get("children"), list) else []
        for child in children:
            child_sets.update(walk(child))
        if uid:
            labels[uid] = text or uid
            child_sets.add(uid)
            descendants[uid] = set(child_sets)
        return child_sets

    walk(root)
    return descendants, labels


def get_reviewable_doc_node_uids(editor_doc: Any) -> set[str]:
    descendants, _ = collect_doc_nodes_with_descendants(editor_doc)
    doc = _deserialize(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    root_data = root.get("data") if isinstance(root, dict) and isinstance(root.get("data"), dict) else {}
    root_uid = str(root_data.get(NODE_UID_KEY) or "").strip()
    return {uid for uid in descendants if uid and uid != root_uid}


def expand_segment_node_uids(palace: Palace, selected_node_uids: list[str]) -> list[str]:
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    expanded: list[str] = []
    for uid in selected_node_uids:
        for item in sorted(descendants.get(uid, {uid})):
            if item not in expanded:
                expanded.append(item)
    return expanded


def normalize_segment_node_uids(
    session: Session,
    palace: Palace,
    selected_node_uids: list[str],
    *,
    exclude_segment_id: int | None = None,
) -> list[str]:
    expanded = expand_segment_node_uids(palace, selected_node_uids)
    taken_uids: set[str] = set()
    for segment in palace.segments:
        if exclude_segment_id is not None and segment.id == exclude_segment_id:
            continue
        taken_uids.update(parse_segment_node_uids(segment.node_uids_json))
    return [uid for uid in expanded if uid not in taken_uids]


def cleanup_segment_node_uids(session: Session, palace: Palace) -> bool:
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    valid_uids = set(descendants.keys())
    changed = False
    claimed_uids: set[str] = set()
    for segment in sorted(palace.segments, key=lambda item: (item.sort_order, item.id)):
        current_uids = parse_segment_node_uids(segment.node_uids_json)
        next_uids: list[str] = []
        for uid in current_uids:
            if uid not in valid_uids or uid in claimed_uids:
                changed = True
                continue
            next_uids.append(uid)
            claimed_uids.add(uid)
        if next_uids != current_uids:
            segment.node_uids_json = serialize_segment_node_uids(next_uids)
            changed = True
    if changed:
        session.flush()
    return changed


def remaining_unclaimed_node_uids(palace: Palace) -> list[str]:
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    all_uids = set(descendants.keys())
    claimed_uids: set[str] = set()
    for segment in palace.segments:
        claimed_uids.update(parse_segment_node_uids(segment.node_uids_json))
    return sorted(uid for uid in all_uids if uid not in claimed_uids)


def build_segments_editor_doc(
    palace: Palace,
    segment_node_uid_lists: list[list[str]],
) -> dict[str, Any]:
    doc = _deserialize(palace.editor_doc, {})
    if not isinstance(doc, dict):
        fallback_title = palace.title or "未命名宫殿"
        return {"root": {"data": {"text": fallback_title}, "children": []}}
    selected_uids = {
        uid
        for node_uids in segment_node_uid_lists
        for uid in node_uids
    }
    root = doc.get("root") if isinstance(doc.get("root"), dict) else {}

    def keep(node: Any, is_root: bool = False) -> Any:
        if not isinstance(node, dict):
            return None
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = str(data.get(NODE_UID_KEY) or "").strip()
        children = node.get("children") if isinstance(node.get("children"), list) else []
        next_children = [child for child in (keep(child) for child in children) if child]
        if is_root or uid in selected_uids or next_children:
            cloned = json.loads(json.dumps(node, ensure_ascii=False))
            cloned["children"] = next_children
            return cloned
        return None

    next_root = keep(root, True) or root
    next_doc = json.loads(json.dumps(doc, ensure_ascii=False))
    next_doc["root"] = next_root
    return next_doc
