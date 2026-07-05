from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.modules.mindmap.application.editor_state_documents import (
    NODE_UID_KEY,
    plain_editor_text,
)

MIN_SECONDS_PER_NODE = 30
TARGET_SECONDS_PER_NODE = 45
MAX_SECONDS_PER_NODE = 60
MIN_REVIEW_SECONDS = 60
TARGET_SEGMENT_NODE_COUNT = 12
MAX_SEGMENT_SUGGESTIONS = 12


@dataclass(frozen=True)
class ReviewPreviewNode:
    title: str
    note: str
    uid: str | None
    children: tuple[ReviewPreviewNode, ...]


def build_review_preview_payload(
    *,
    editor_doc: Any | None = None,
    source_tree: Any | None = None,
) -> dict[str, Any]:
    root = _coerce_editor_root(editor_doc) or _coerce_source_tree_root(source_tree)
    warnings: list[str] = []
    if root is None:
        warnings.append("missing_review_tree")
        return _empty_preview(warnings)

    review_nodes = _flatten_nodes(root.children)
    node_count = len(review_nodes)
    if node_count == 0:
        warnings.append("empty_review_tree")

    difficulty_distribution = _difficulty_distribution(review_nodes)
    if node_count >= 100:
        warnings.append("large_review_tree")
    if node_count > 0 and difficulty_distribution["hard"] / node_count >= 0.4:
        warnings.append("hard_node_heavy_tree")

    suggested_segments = _suggest_segments(root)
    if suggested_segments["count"] > MAX_SEGMENT_SUGGESTIONS:
        warnings.append("many_suggested_segments")

    estimated_seconds = _estimate_seconds(node_count, TARGET_SECONDS_PER_NODE)
    return {
        "node_count": node_count,
        "estimated_review_seconds": estimated_seconds,
        "estimated_review_time": {
            "min_seconds": _estimate_seconds(node_count, MIN_SECONDS_PER_NODE),
            "max_seconds": _estimate_seconds(node_count, MAX_SECONDS_PER_NODE),
            "min_minutes": _seconds_to_minutes(
                _estimate_seconds(node_count, MIN_SECONDS_PER_NODE)
            ),
            "max_minutes": _seconds_to_minutes(
                _estimate_seconds(node_count, MAX_SECONDS_PER_NODE)
            ),
        },
        "suggested_segments": suggested_segments,
        "difficulty_distribution": difficulty_distribution,
        "warnings": warnings,
    }


def _empty_preview(warnings: list[str]) -> dict[str, Any]:
    return {
        "node_count": 0,
        "estimated_review_seconds": 0,
        "estimated_review_time": {
            "min_seconds": 0,
            "max_seconds": 0,
            "min_minutes": 0,
            "max_minutes": 0,
        },
        "suggested_segments": {"count": 0, "items": [], "list": []},
        "difficulty_distribution": {"easy": 0, "medium": 0, "hard": 0},
        "warnings": warnings,
    }


def _coerce_editor_root(editor_doc: Any | None) -> ReviewPreviewNode | None:
    if not isinstance(editor_doc, dict):
        return None
    root = editor_doc.get("root")
    if not isinstance(root, dict):
        return None
    return _coerce_editor_node(root)


def _coerce_editor_node(node: dict[str, Any]) -> ReviewPreviewNode:
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    children = node.get("children") if isinstance(node.get("children"), list) else []
    return ReviewPreviewNode(
        title=plain_editor_text(data.get("text"), fallback="").strip(),
        note=plain_editor_text(data.get("note"), fallback="").strip(),
        uid=str(data.get(NODE_UID_KEY) or "").strip() or None,
        children=tuple(
            _coerce_editor_node(child)
            for child in children
            if isinstance(child, dict)
        ),
    )


def _coerce_source_tree_root(source_tree: Any | None) -> ReviewPreviewNode | None:
    if not isinstance(source_tree, dict):
        return None
    children = source_tree.get("children") if isinstance(source_tree.get("children"), list) else []
    return ReviewPreviewNode(
        title=_source_text(source_tree.get("title")),
        note="",
        uid=None,
        children=tuple(
            _coerce_source_node(child)
            for child in children
            if isinstance(child, dict)
        ),
    )


def _coerce_source_node(node: dict[str, Any]) -> ReviewPreviewNode:
    children = node.get("children") if isinstance(node.get("children"), list) else []
    return ReviewPreviewNode(
        title=_source_text(node.get("rich_text_html") or node.get("text")),
        note="",
        uid=None,
        children=tuple(
            _coerce_source_node(child)
            for child in children
            if isinstance(child, dict)
        ),
    )


def _source_text(value: Any) -> str:
    return plain_editor_text(value, fallback="").strip()


def _flatten_nodes(nodes: tuple[ReviewPreviewNode, ...]) -> list[ReviewPreviewNode]:
    flattened: list[ReviewPreviewNode] = []
    stack = list(reversed(nodes))
    while stack:
        node = stack.pop()
        flattened.append(node)
        stack.extend(reversed(node.children))
    return flattened


def _difficulty_distribution(nodes: list[ReviewPreviewNode]) -> dict[str, int]:
    distribution = {"easy": 0, "medium": 0, "hard": 0}
    for node in nodes:
        distribution[_node_difficulty(node)] += 1
    return distribution


def _node_difficulty(node: ReviewPreviewNode) -> str:
    text_size = len(node.title) + len(node.note)
    subtree_size = _subtree_node_count(node)
    child_count = len(node.children)
    if text_size > 120 or subtree_size >= 8 or child_count >= 5 or _max_depth(node) >= 4:
        return "hard"
    if text_size <= 32 and child_count == 0:
        return "easy"
    return "medium"


def _subtree_node_count(node: ReviewPreviewNode) -> int:
    return 1 + sum(_subtree_node_count(child) for child in node.children)


def _max_depth(node: ReviewPreviewNode) -> int:
    if not node.children:
        return 1
    return 1 + max(_max_depth(child) for child in node.children)


def _estimate_seconds(node_count: int, seconds_per_node: int) -> int:
    if node_count <= 0:
        return 0
    return max(MIN_REVIEW_SECONDS, node_count * seconds_per_node)


def _seconds_to_minutes(seconds: int) -> int:
    if seconds <= 0:
        return 0
    return max(1, round(seconds / 60))


def _suggest_segments(root: ReviewPreviewNode) -> dict[str, Any]:
    candidates = _segment_candidates(root)
    items = [
        {
            "title": candidate.title or f"Segment {index}",
            "node_count": _subtree_node_count(candidate),
            "estimated_review_seconds": _estimate_seconds(
                _subtree_node_count(candidate),
                TARGET_SECONDS_PER_NODE,
            ),
            **({"uid": candidate.uid} if candidate.uid else {}),
        }
        for index, candidate in enumerate(candidates[:MAX_SEGMENT_SUGGESTIONS], start=1)
    ]
    return {
        "count": len(items),
        "items": items,
        "list": items,
    }


def _segment_candidates(root: ReviewPreviewNode) -> list[ReviewPreviewNode]:
    if len(root.children) >= 2:
        return list(root.children)
    if len(root.children) == 1 and _subtree_node_count(root.children[0]) > TARGET_SEGMENT_NODE_COUNT:
        child = root.children[0]
        if len(child.children) >= 2:
            return list(child.children)
    return []
