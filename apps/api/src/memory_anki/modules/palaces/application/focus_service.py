from __future__ import annotations

import json

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace


def parse_focus_node_uids(palace: Palace | None) -> list[str]:
    raw = getattr(palace, "focus_node_uids_json", "[]") if palace else "[]"
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in parsed:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def set_focus_node_uids(palace: Palace, node_uids: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in node_uids:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    palace.focus_node_uids_json = json.dumps(normalized, ensure_ascii=False)
    return normalized


def toggle_focus_node_uid(palace: Palace, node_uid: str) -> tuple[list[str], bool]:
    normalized_uid = str(node_uid or "").strip()
    current = parse_focus_node_uids(palace)
    if not normalized_uid:
        return current, False
    if normalized_uid in current:
        next_uids = [uid for uid in current if uid != normalized_uid]
        set_focus_node_uids(palace, next_uids)
        return next_uids, False
    next_uids = [*current, normalized_uid]
    set_focus_node_uids(palace, next_uids)
    return next_uids, True


def update_focus_node_uid(
    session: Session,
    palace: Palace,
    node_uid: str,
    focused: bool | None,
) -> tuple[list[str], bool]:
    normalized_uid = str(node_uid or "").strip()
    if focused is None:
        focus_node_uids, is_focused = toggle_focus_node_uid(palace, normalized_uid)
    else:
        current_uids = parse_focus_node_uids(palace)
        if not normalized_uid:
            focus_node_uids = current_uids
            is_focused = False
        elif focused:
            focus_node_uids = set_focus_node_uids(palace, [*current_uids, normalized_uid])
            is_focused = True
        else:
            focus_node_uids = set_focus_node_uids(
                palace,
                [uid for uid in current_uids if uid != normalized_uid],
            )
            is_focused = False
    session.commit()
    session.refresh(palace)
    return focus_node_uids, is_focused


def _parse_editor_doc(raw_doc: str | dict | None) -> dict | None:
    if not raw_doc:
        return None
    if isinstance(raw_doc, dict):
        return raw_doc
    if isinstance(raw_doc, str):
        try:
            parsed = json.loads(raw_doc)
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _node_uid(node: dict, fallback_id: str) -> str:
    data = node.get("data") or {}
    return str(data.get("uid") or data.get("memoryAnkiId") or fallback_id)


def build_focus_editor_doc(palace: Palace) -> dict:
    doc = _parse_editor_doc(getattr(palace, "editor_doc", None))
    if not doc or not isinstance(doc.get("root"), dict):
        return {"root": {"data": {"text": palace.title or "未命名导图"}, "children": []}}

    focus_ids = set(parse_focus_node_uids(palace))
    if not focus_ids:
        return {"root": {"data": {"text": palace.title or "未命名导图"}, "children": []}}

    def walk(node: dict, fallback_id: str) -> tuple[dict | None, bool]:
        current_id = _node_uid(node, fallback_id)
        raw_children = node.get("children") or []
        next_children: list[dict] = []
        has_focus_descendant = current_id in focus_ids
        for index, child in enumerate(raw_children):
            if not isinstance(child, dict):
                continue
            trimmed_child, child_has_focus = walk(child, f"{fallback_id}-{index}")
            if trimmed_child is not None:
                next_children.append(trimmed_child)
            if child_has_focus:
                has_focus_descendant = True
        if not has_focus_descendant and current_id not in focus_ids:
            return None, False
        next_node = json.loads(json.dumps(node))
        next_node["children"] = next_children
        return next_node, True

    trimmed_root, _ = walk(doc["root"], "root")
    return {
        **doc,
        "root": trimmed_root or {"data": {"text": palace.title or "未命名导图"}, "children": []},
    }
