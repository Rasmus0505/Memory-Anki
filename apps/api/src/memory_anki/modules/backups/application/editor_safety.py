from __future__ import annotations

import json

MIN_DANGEROUS_NODE_COUNT = 5
MAX_SAFE_REMAINING_NODES = 2


def count_editor_doc_nodes(doc: dict | str | None) -> int:
    if doc in (None, ""):
        return 0
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except Exception:
            return 0
    if not isinstance(doc, dict):
        return 0
    root = doc.get("root")
    if not isinstance(root, dict):
        return 0

    def walk(node: dict) -> int:
        children = node.get("children")
        if not isinstance(children, list):
            children = []
        return 1 + sum(walk(child) for child in children if isinstance(child, dict))

    return max(0, walk(root) - 1)


def is_dangerous_structure_change(
    existing_node_count: int,
    next_node_count: int,
) -> bool:
    return (
        existing_node_count >= MIN_DANGEROUS_NODE_COUNT
        and next_node_count <= MAX_SAFE_REMAINING_NODES
        and next_node_count < existing_node_count
    )
