"""Read queries for content (palace/knowledge documents).

Transitional re-exports from legacy palaces.api until files move in W2.
"""

from __future__ import annotations

from memory_anki.modules.palaces.api import (
    ancestor_path,
    build_today_new_palace_outline,
    build_tree_from_editor_doc,
    get_palace_explicit_chapter_ids,
    get_palace_tree_structure,
    list_active_palace_tree_structures,
    palace_json,
    parse_segment_node_uids,
    resolve_palace_subject,
    resolve_palace_title,
    stable_tree_order,
    subtree_node_uids,
)

__all__ = [
    "ancestor_path",
    "build_today_new_palace_outline",
    "build_tree_from_editor_doc",
    "get_palace_explicit_chapter_ids",
    "get_palace_tree_structure",
    "list_active_palace_tree_structures",
    "palace_json",
    "parse_segment_node_uids",
    "resolve_palace_subject",
    "resolve_palace_title",
    "stable_tree_order",
    "subtree_node_uids",
]
