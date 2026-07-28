"""Framework-free projection of an editor document into a stable tree."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _fingerprint(data: dict[str, Any]) -> str:
    stable = dict(data)
    for key in ("expand", "isActive", "permanentSplitMark", "permanent_split_mark"):
        stable.pop(key, None)
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_document_tree(editor_doc: Any) -> tuple[str | None, dict[str, dict[str, Any]]]:
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

    def walk(raw: dict[str, Any], parent_uid: str | None, fallback: str) -> str:
        value = raw.get("data")
        data = value if isinstance(value, dict) else {}
        uid = str(data.get("uid") or data.get("memoryAnkiId") or fallback).strip()
        children = [
            walk(child, uid, f"{fallback}-{index}")
            for index, child in enumerate(raw.get("children") or [])
            if isinstance(child, dict)
        ]
        nodes[uid] = {
            "uid": uid,
            "parent_uid": parent_uid,
            "children": children,
            "text": str(data.get("text") or "").strip(),
            "content_fingerprint": _fingerprint(data),
            "permanent_split_mark": data.get("permanentSplitMark") is True
            or data.get("permanent_split_mark") is True,
        }
        return uid

    root_uid = walk(root, None, "root")
    return root_uid, nodes


__all__ = ["build_document_tree"]
