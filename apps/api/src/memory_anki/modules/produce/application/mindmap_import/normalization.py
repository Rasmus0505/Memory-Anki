from __future__ import annotations

import uuid
from typing import Any

from memory_anki.modules.mindmap_document.api import normalize_editor_doc

from .contracts import MindMapImportError
from .model_io import MAX_IMAGE_BYTES
from .pdf_normalization import (
    PDF_INFERRED_RELATION_KEYWORDS as PDF_INFERRED_RELATION_KEYWORDS,
)
from .pdf_normalization import (
    build_pdf_parent_children as build_pdf_parent_children,
)
from .pdf_normalization import (
    dedupe_pdf_child_items as dedupe_pdf_child_items,
)
from .pdf_normalization import (
    extract_pdf_child_items as extract_pdf_child_items,
)
from .pdf_normalization import (
    infer_pdf_child_restructure as infer_pdf_child_restructure,
)
from .pdf_normalization import (
    infer_pdf_dash_relation as infer_pdf_dash_relation,
)
from .pdf_normalization import (
    infer_pdf_definition_relation as infer_pdf_definition_relation,
)
from .pdf_normalization import (
    infer_pdf_grouping_relation as infer_pdf_grouping_relation,
)
from .pdf_normalization import (
    infer_pdf_heading_relation as infer_pdf_heading_relation,
)
from .pdf_normalization import (
    infer_pdf_hierarchy as infer_pdf_hierarchy,
)
from .pdf_normalization import (
    merge_duplicate_pdf_children as merge_duplicate_pdf_children,
)
from .pdf_normalization import (
    normalize_pdf_child_phrase as normalize_pdf_child_phrase,
)
from .pdf_normalization import (
    normalize_pdf_parent_phrase as normalize_pdf_parent_phrase,
)
from .pdf_normalization import (
    normalize_pdf_source_node as normalize_pdf_source_node,
)
from .rich_text import (
    apply_emphasis_marks_to_html as apply_emphasis_marks_to_html,
)
from .rich_text import (
    html_to_plain_text as html_to_plain_text,
)
from .rich_text import (
    normalize_emphasis_marks as normalize_emphasis_marks,
)
from .rich_text import (
    normalize_rich_text_html as normalize_rich_text_html,
)
from .rich_text import (
    to_rich_text_html as to_rich_text_html,
)
from .text_splitting import (
    ABSTRACT_SPLIT_HEADINGS as ABSTRACT_SPLIT_HEADINGS,
)
from .text_splitting import (
    LONG_NODE_SPLIT_THRESHOLD as LONG_NODE_SPLIT_THRESHOLD,
)
from .text_splitting import (
    MAX_SPLIT_CHILDREN as MAX_SPLIT_CHILDREN,
)
from .text_splitting import (
    NODE_WRAP_MIN_WIDTH as NODE_WRAP_MIN_WIDTH,
)
from .text_splitting import (
    NODE_WRAP_WIDTH as NODE_WRAP_WIDTH,
)
from .text_splitting import (
    clean_multiline_text as clean_multiline_text,
)
from .text_splitting import (
    extract_parallel_items as extract_parallel_items,
)
from .text_splitting import (
    find_wrap_index as find_wrap_index,
)
from .text_splitting import (
    format_node_text_for_card as format_node_text_for_card,
)
from .text_splitting import (
    is_abstract_heading as is_abstract_heading,
)
from .text_splitting import (
    promote_single_verbose_child,
    split_overlong_leaf_node,
)
from .text_splitting import (
    split_comma_series as split_comma_series,
)
from .text_splitting import (
    split_heading_and_body as split_heading_and_body,
)
from .text_splitting import (
    split_numbered_items as split_numbered_items,
)
from .text_splitting import (
    wrap_node_line as wrap_node_line,
)

__all__ = [
    "MAX_IMAGE_BYTES",
    "normalize_source_tree",
    "normalize_pdf_source_tree",
    "build_editor_doc",
    "html_to_plain_text",
]

MAX_NODE_COUNT = 400

def normalize_source_tree(value: Any, *, disable_rebalance: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的顶层结构不是对象。")
    title = value.get("title")
    if not isinstance(title, str):
        raise MindMapImportError("模型返回缺少 title 字符串。")
    children = value.get("children")
    if not isinstance(children, list):
        raise MindMapImportError("模型返回缺少 children 数组。")

    counter = {"count": 0}
    for child in children:
        validate_source_node(child, counter)
    if counter["count"] > MAX_NODE_COUNT:
        raise MindMapImportError("识别出的节点过多，请换一张更聚焦的图片后重试。")
    return value


def normalize_pdf_source_tree(value: Any) -> dict[str, Any]:
    return normalize_source_tree(value, disable_rebalance=True)


def normalize_source_node(value: Any, counter: dict[str, int]) -> dict[str, Any]:
    validate_source_node(value, counter)
    return value


def validate_source_node(value: Any, counter: dict[str, int]) -> None:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的节点结构非法。")
    text = value.get("text")
    if not isinstance(text, str) or not text.strip():
        raise MindMapImportError("模型返回了空节点文本。")
    counter["count"] += 1
    raw_children = value.get("children")
    if not isinstance(raw_children, list):
        raise MindMapImportError("模型返回的 children 不是数组。")
    for child in raw_children:
        validate_source_node(child, counter)


def rebalance_long_leaf_node(source_node: dict[str, Any]) -> dict[str, Any]:
    children = [rebalance_long_leaf_node(child) for child in source_node["children"]]
    node = {
        "text": source_node["text"],
        "rich_text_html": source_node.get("rich_text_html"),
        "emphasis_marks": source_node.get("emphasis_marks") or [],
        "children": children,
    }
    if children:
        promoted = promote_single_verbose_child(node)
        return promoted or node
    split_node = split_overlong_leaf_node(node["text"])
    return split_node or node


def build_editor_doc(
    source_tree: dict[str, Any],
    *,
    fallback_title: str,
    preserve_line_breaks: bool,
) -> dict[str, Any]:
    root_text = source_tree.get("title") or fallback_title or "未命名宫殿"
    raw_doc = {
        "root": {
            "data": {
                "text": root_text,
            },
            "children": [
                source_node_to_editor_node(child, preserve_line_breaks=preserve_line_breaks)
                for child in source_tree["children"]
            ],
        }
    }
    return normalize_editor_doc(raw_doc, root_text=root_text, root_kind="palace")


def source_node_to_editor_node(source_node: dict[str, Any], *, preserve_line_breaks: bool) -> dict[str, Any]:
    plain = str(source_node.get("text") or "")
    rich_text_html = normalize_rich_text_html(
        source_node.get("rich_text_html"),
        text=plain,
        emphasis_marks=source_node.get("emphasis_marks"),
        preserve_line_breaks=preserve_line_breaks,
    )
    data: dict[str, Any] = {
        "uid": uuid.uuid4().hex,
        "text": plain,
    }
    if rich_text_html:
        data["text"] = rich_text_html
        data["richText"] = True
    return {
        "data": data,
        "children": [
            source_node_to_editor_node(child, preserve_line_breaks=preserve_line_breaks)
            for child in (source_node.get("children") or [])
            if isinstance(child, dict)
        ],
    }
