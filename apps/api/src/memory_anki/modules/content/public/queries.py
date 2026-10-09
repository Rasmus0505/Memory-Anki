"""Read queries for content (palace/knowledge documents)."""

from __future__ import annotations

from memory_anki.modules.content.api import (
    ancestor_path,
    build_today_new_palace_outline,
    build_tree_from_editor_doc,
    get_palace_explicit_chapter_ids,
    get_palace_tree_structure,
    list_active_palace_ids_by_subject_ids,
    list_active_palace_ids_by_subject_scope,
    list_active_palace_tree_structures,
    list_node_parent_uids,
    palace_json,
    parse_segment_node_uids,
    read_learning_progress_catalog,
    resolve_palace_subject,
    resolve_palace_title,
    resolve_palace_titles,
    stable_tree_order,
    subtree_node_uids,
)

__all__ = [
    "read_learning_progress_catalog",
    "ancestor_path",
    "build_today_new_palace_outline",
    "build_tree_from_editor_doc",
    "get_palace_explicit_chapter_ids",
    "get_palace_tree_structure",
    "list_active_palace_tree_structures",
    "list_node_parent_uids",
    "list_active_palace_ids_by_subject_ids",
    "list_active_palace_ids_by_subject_scope",
    "palace_json",
    "parse_segment_node_uids",
    "resolve_palace_subject",
    "resolve_palace_title",
    "resolve_palace_titles",
    "stable_tree_order",
    "subtree_node_uids",
]
