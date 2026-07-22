"""Public palace context facade for cross-context composition."""

from .application.chapter_binding_commands import update_palace_chapter_binding
from .application.palace_serializer import palace_json
from .application.segment_nodes import parse_segment_node_uids
from .application.segment_review_service import palace_review_stages_json
from .application.title_sync_service import (
    build_today_new_palace_outline,
    get_palace_explicit_chapter_ids,
    resolve_palace_subject,
    resolve_palace_title,
)
from .application.tree_structure import (
    ancestor_path,
    build_tree_from_editor_doc,
    get_palace_tree_structure,
    list_active_palace_tree_structures,
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
    "palace_review_stages_json",
    "resolve_palace_subject",
    "resolve_palace_title",
    "stable_tree_order",
    "subtree_node_uids",
    "update_palace_chapter_binding",
]
