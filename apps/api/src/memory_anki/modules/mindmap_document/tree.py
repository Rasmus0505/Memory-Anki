"""Framework-free projection of an editor document into a stable tree."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .document import NODE_ID_KEY, NODE_TYPE_KEY, NODE_UID_KEY, ROOT_KIND_KEY


def _fingerprint(data: dict[str, Any]) -> str:
    stable = dict(data)
    for key in ("expand", "isActive", "permanentSplitMark", "permanent_split_mark"):
        stable.pop(key, None)
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_document_tree(
    editor_doc: Any, *, compact: bool = False
) -> tuple[str | None, dict[str, dict[str, Any]]]:
    """Project nodes in postorder, preserving document order within each child list.

    The compact palace projection omits ancestry and editor metadata, and only
    includes the permanent split mark when it is true.
    """
    document = editor_doc
    if isinstance(editor_doc, str):
        try:
            document = json.loads(editor_doc or "{}")
        except (TypeError, ValueError):
            return None, {}
    root = document.get("root") if isinstance(document, dict) else None
    if not isinstance(root, dict):
        return None, {}
    nodes: dict[str, dict[str, Any]] = {}

    def walk(
        raw: dict[str, Any],
        parent_uid: str | None,
        fallback: str,
        ancestor_path: list[dict[str, str]],
        depth: int,
    ) -> str:
        value = raw.get("data")
        data = value if isinstance(value, dict) else {}
        uid = str(data.get(NODE_UID_KEY) or data.get(NODE_ID_KEY) or fallback).strip()
        text = str(data.get("text") or "").strip()
        path = ancestor_path if compact else [*ancestor_path, {"uid": uid, "text": text}]
        children_raw = raw.get("children")
        if compact:
            children_iterable = children_raw if isinstance(children_raw, list) else []
        else:
            try:
                children_iterable = children_raw or []
                iter(children_iterable)
            except TypeError:
                children_iterable = []
        children = [
            walk(child, uid, f"{fallback}-{index}", path, depth + 1)
            for index, child in enumerate(children_iterable)
            if isinstance(child, dict)
        ]
        node = {
            "uid": uid,
            "parent_uid": parent_uid,
            "children": children,
            "text": text,
        }
        if not compact:
            node.update(
                note=str(data.get("note") or "").strip(),
                node_type=str(data.get(NODE_TYPE_KEY) or data.get("type") or "").strip(),
                root_kind=str(data.get(ROOT_KIND_KEY) or "").strip(),
                depth=depth,
                ancestor_path=path,
            )
        node["content_fingerprint"] = _fingerprint(data)
        marked = data.get("permanentSplitMark") is True or data.get("permanent_split_mark") is True
        if marked or not compact:
            node["permanent_split_mark"] = marked
        nodes[uid] = node
        return uid

    root_uid = walk(root, None, "root", [], 0)
    return root_uid, nodes


__all__ = ["build_document_tree"]
