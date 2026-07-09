from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceMiniPalace
from memory_anki.modules.mindmap.application.editor_state_documents import (
    deserialize_editor_payload,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    collect_doc_nodes_with_descendants,
)


def parse_mini_palace_node_uids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return _unique_strings(data)


def serialize_mini_palace_node_uids(node_uids: list[str]) -> str:
    return json.dumps(_unique_strings(node_uids), ensure_ascii=False)


def build_mini_palace_editor_doc(
    palace: Palace,
    mini_palace: PalaceMiniPalace,
) -> dict[str, Any]:
    return build_segments_editor_doc(
        palace,
        [parse_mini_palace_node_uids(mini_palace.node_uids_json)],
    )


def cleanup_mini_palace_node_uids(session: Session, palace: Palace) -> bool:
    valid_uids = _valid_checkpoint_uids(palace)
    changed = False
    for mini_palace in palace.mini_palaces:
        current_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
        next_uids = [uid for uid in current_uids if uid in valid_uids]
        if next_uids != current_uids:
            mini_palace.node_uids_json = serialize_mini_palace_node_uids(next_uids)
            mini_palace.updated_at = utc_now_naive()
            changed = True
    if changed:
        session.flush()
    return changed


def normalize_mini_palace_node_uids(palace: Palace, value: Any) -> list[str]:
    valid_uids = _valid_checkpoint_uids(palace)
    values = value if isinstance(value, list) else []
    return [uid for uid in _unique_strings(values) if uid in valid_uids]


def resolve_mini_palace_name(
    palace: Palace,
    value: Any,
    *,
    node_uids: list[str] | None = None,
    exclude_id: int | None = None,
) -> str:
    raw = str(value or "").strip()
    if raw:
        return raw
    preferred = _default_mini_palace_name_from_node_uids(palace, node_uids)
    if preferred:
        return preferred
    preferred = _default_mini_palace_name_from_first_child(palace)
    if preferred:
        return preferred
    existing_names = {
        str(item.name or "").strip()
        for item in palace.mini_palaces
        if exclude_id is None or item.id != exclude_id
    }
    index = 1
    while True:
        candidate = f"专项训练 {index}"
        if candidate not in existing_names:
            return candidate
        index += 1


def _valid_checkpoint_uids(palace: Palace) -> set[str]:
    valid_uids = set(collect_doc_nodes_with_descendants(palace.editor_doc)[0].keys())
    root_uid = _get_root_uid(palace.editor_doc)
    if root_uid:
        valid_uids.discard(root_uid)
    return valid_uids


def _get_root_uid(editor_doc: Any) -> str:
    try:
        doc = json.loads(editor_doc) if isinstance(editor_doc, str) else editor_doc
    except Exception:
        return ""
    if not isinstance(doc, dict):
        return ""
    root = doc.get("root")
    if not isinstance(root, dict):
        return ""
    data = root.get("data")
    if not isinstance(data, dict):
        return ""
    return str(data.get("uid") or "").strip()


def _unique_strings(values: Any) -> list[str]:
    result: list[str] = []
    if not isinstance(values, list):
        return result
    for item in values:
        text = str(item or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def _default_mini_palace_name_from_first_child(palace: Palace) -> str:
    doc = deserialize_editor_payload(getattr(palace, "editor_doc", None), {})
    root = doc.get("root") if isinstance(doc, dict) else None
    children = root.get("children") if isinstance(root, dict) else None
    first_child = children[0] if isinstance(children, list) and children else None
    data = first_child.get("data") if isinstance(first_child, dict) else None
    raw_text = str(data.get("text") or "").strip() if isinstance(data, dict) else ""
    if not raw_text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw_text).replace("&nbsp;", " ")).strip()


def _node_text_by_uid(palace: Palace) -> dict[str, str]:
    doc = deserialize_editor_payload(getattr(palace, "editor_doc", None), {})
    root = doc.get("root") if isinstance(doc, dict) else None
    result: dict[str, str] = {}

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            uid = str(data.get("uid") or "").strip()
            raw_text = str(data.get("text") or "").strip()
            normalized_text = re.sub(
                r"\s+", " ", re.sub(r"<[^>]+>", " ", raw_text).replace("&nbsp;", " ")
            ).strip()
            if uid and normalized_text:
                result[uid] = normalized_text
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                visit(child)

    visit(root)
    return result


def _default_mini_palace_name_from_node_uids(
    palace: Palace,
    node_uids: list[str] | None,
) -> str:
    if not node_uids:
        return ""
    text_by_uid = _node_text_by_uid(palace)
    for uid in node_uids:
        text = text_by_uid.get(uid, "").strip()
        if text:
            return text
    return ""
