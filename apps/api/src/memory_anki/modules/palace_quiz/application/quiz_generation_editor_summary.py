"""Editor document summarization helpers for quiz generation."""

from __future__ import annotations

from typing import Any

from memory_anki.modules.mindmap.application.editor_state_documents import deserialize_editor_payload


def node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    return str(data.get("text") or node.get("text") or "").strip()


def node_children(node: Any) -> list[Any]:
    if not isinstance(node, dict):
        return []
    children = node.get("children")
    return children if isinstance(children, list) else []


def extract_first_multi_node_summary(editor_doc: Any, *, max_items: int = 24) -> list[str]:
    doc = deserialize_editor_payload(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    if not isinstance(root, dict):
        return []
    current_level = node_children(root)
    while current_level:
        texts = [node_text(node) for node in current_level if node_text(node)]
        if len(texts) >= 2:
            return texts[:max_items]
        next_level: list[Any] = []
        for node in current_level:
            next_level.extend(node_children(node))
        current_level = next_level
    return []


__all__ = [
    "extract_first_multi_node_summary",
    "node_children",
    "node_text",
]
