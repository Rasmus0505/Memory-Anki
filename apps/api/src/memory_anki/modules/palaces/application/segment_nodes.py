from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.mindmap_document.api import (
    NODE_UID_KEY,
    collect_node_descendants,
    deserialize_editor_payload,
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
    return collect_node_descendants(editor_doc)


def get_reviewable_doc_node_uids(editor_doc: Any) -> set[str]:
    descendants, _ = collect_doc_nodes_with_descendants(editor_doc)
    doc = deserialize_editor_payload(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    raw_root_data = root.get("data") if isinstance(root, dict) else None
    root_data = raw_root_data if isinstance(raw_root_data, dict) else {}
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
    del session, exclude_segment_id
    return expand_segment_node_uids(palace, selected_node_uids)


def cleanup_segment_node_uids(session: Session, palace: Palace) -> bool:
    descendants, _ = collect_doc_nodes_with_descendants(palace.editor_doc)
    valid_uids = set(descendants.keys())
    changed = False
    for segment in sorted(palace.segments, key=lambda item: (item.sort_order, item.id)):
        current_uids = parse_segment_node_uids(segment.node_uids_json)
        next_uids: list[str] = []
        for uid in current_uids:
            if uid not in valid_uids:
                changed = True
                continue
            next_uids.append(uid)
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
    doc = deserialize_editor_payload(palace.editor_doc, {})
    if not isinstance(doc, dict):
        fallback_title = palace.title or "未命名宫殿"
        return {"root": {"data": {"text": fallback_title}, "children": []}}
    selected_uids = {
        uid
        for node_uids in segment_node_uid_lists
        for uid in node_uids
    }
    raw_root = doc.get("root")
    root = raw_root if isinstance(raw_root, dict) else {}

    def keep(node: Any, is_root: bool = False) -> Any:
        if not isinstance(node, dict):
            return None
        raw_data = node.get("data")
        data = raw_data if isinstance(raw_data, dict) else {}
        uid = str(data.get(NODE_UID_KEY) or "").strip()
        raw_children = node.get("children")
        children = raw_children if isinstance(raw_children, list) else []
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
