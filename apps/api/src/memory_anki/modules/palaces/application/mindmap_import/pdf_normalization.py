from __future__ import annotations

import re
from typing import Any

from .text_splitting import (
    clean_multiline_text,
    split_comma_series,
    split_heading_and_body,
    split_numbered_items,
)
from .text_utils import clean_inline_text

PDF_INFERRED_RELATION_KEYWORDS = (
    "性质",
    "目的",
    "内容",
    "方法",
    "特点",
    "作用",
    "意义",
    "要求",
    "原则",
    "任务",
    "形式",
    "阶段",
    "构成",
    "分类",
)


def normalize_pdf_source_node(source_node: dict[str, Any]) -> dict[str, Any]:
    normalized_children = [normalize_pdf_source_node(child) for child in source_node.get("children") or []]
    node = {
        "text": clean_multiline_text(source_node.get("text")),
        "rich_text_html": source_node.get("rich_text_html"),
        "emphasis_marks": source_node.get("emphasis_marks") or [],
        "children": normalized_children,
    }

    inferred = infer_pdf_hierarchy(node)
    if inferred is not None:
        node = inferred

    return merge_duplicate_pdf_children(node)


def infer_pdf_hierarchy(node: dict[str, Any]) -> dict[str, Any] | None:
    child_inference = infer_pdf_child_restructure(node)
    if child_inference is not None:
        return child_inference

    if node.get("children"):
        return None

    text = clean_inline_text(node.get("text"))
    if not text:
        return None

    inferred = (
        infer_pdf_dash_relation(text)
        or infer_pdf_heading_relation(text)
        or infer_pdf_definition_relation(text)
        or infer_pdf_grouping_relation(text)
    )
    if inferred is None:
        return None
    return {
        "text": inferred["text"],
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": inferred["children"],
    }


def infer_pdf_child_restructure(node: dict[str, Any]) -> dict[str, Any] | None:
    children = node.get("children") or []
    if len(children) != 1:
        return None

    child = children[0]
    child_text = clean_inline_text(child.get("text"))
    if not child_text:
        return None

    parent_text = clean_inline_text(node.get("text"))
    inferred = (
        infer_pdf_dash_relation(child_text)
        or infer_pdf_heading_relation(child_text)
        or infer_pdf_definition_relation(child_text)
        or infer_pdf_grouping_relation(child_text)
    )
    if inferred is None:
        return None

    inferred_parent = clean_inline_text(inferred["text"])
    if parent_text and inferred_parent and parent_text != inferred_parent:
        return None

    return {
        "text": inferred_parent or parent_text,
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": inferred["children"],
    }


def infer_pdf_dash_relation(text: str) -> dict[str, Any] | None:
    for delimiter in ("——", "--", "—", "－"):
        if delimiter not in text:
            continue
        left, right = text.split(delimiter, 1)
        parent = normalize_pdf_parent_phrase(left)
        right_text = clean_inline_text(right)
        if not parent or not right_text:
            return None
        child_items = extract_pdf_child_items(right_text)
        return build_pdf_parent_children(parent, child_items)
    return None


def infer_pdf_heading_relation(text: str) -> dict[str, Any] | None:
    heading, body = split_heading_and_body(text)
    if not heading or not body:
        return None
    parent = normalize_pdf_parent_phrase(heading)
    if not parent:
        return None
    child_items = extract_pdf_child_items(body)
    if len(child_items) < 2 and not body:
        return None
    return build_pdf_parent_children(parent, child_items)


def infer_pdf_definition_relation(text: str) -> dict[str, Any] | None:
    normalized = clean_inline_text(text)
    if "是" not in normalized:
        return None
    left, right = normalized.split("是", 1)
    parent = normalize_pdf_parent_phrase(left)
    child_text = normalize_pdf_child_phrase(right)
    if not parent or not child_text:
        return None
    if parent == child_text:
        return None
    if not any(keyword in parent for keyword in PDF_INFERRED_RELATION_KEYWORDS):
        return None
    return build_pdf_parent_children(parent, [child_text])


def infer_pdf_grouping_relation(text: str) -> dict[str, Any] | None:
    normalized = clean_inline_text(text)
    for marker in ("包括", "分为"):
        if marker not in normalized:
            continue
        left, right = normalized.split(marker, 1)
        parent = normalize_pdf_parent_phrase(left)
        if not parent:
            return None
        child_items = extract_pdf_child_items(right)
        if len(child_items) < 2:
            return None
        return build_pdf_parent_children(parent, child_items)
    return None


def build_pdf_parent_children(parent: str, child_items: list[str]) -> dict[str, Any]:
    normalized_children: list[dict[str, Any]] = [
        {
            "text": child,
            "rich_text_html": None,
            "emphasis_marks": [],
            "children": [],
        }
        for child in dedupe_pdf_child_items(child_items)
        if child
    ]
    return {
        "text": parent,
        "children": normalized_children,
    }


def normalize_pdf_parent_phrase(value: str) -> str:
    text = clean_inline_text(value)
    if not text:
        return ""
    text = re.sub(r"^[（(]?[0-9一二三四五六七八九十]+[)）][、.]?\s*", "", text)
    text = re.sub(r"^[0-9]+[.、]\s*", "", text)
    text = re.sub(r"^(?:[^的]{1,16})的((?:性质|目的|内容|方法|特点|作用|意义|要求|原则|任务|形式|阶段|构成|分类).*)$", r"\1", text)
    text = re.sub(r"^(.*?)(?:包括|分为)$", r"\1", text)
    text = re.sub(r"^(.*?)(?:是)$", r"\1", text)
    return clean_inline_text(text.strip("：:；;，,。 "))


def normalize_pdf_child_phrase(value: str) -> str:
    text = clean_inline_text(value)
    if not text:
        return ""
    text = re.sub(r"^[\"“”'‘’]+|[\"“”'‘’]+$", "", text)
    text = re.sub(r"^(?:即|主要是|一般是)", "", text)
    return clean_inline_text(text.strip("：:；;，,。 "))


def extract_pdf_child_items(text: str) -> list[str]:
    normalized = clean_inline_text(text)
    if not normalized:
        return []

    numbered_items = split_numbered_items(normalized)
    if len(numbered_items) >= 2:
        return [normalize_pdf_child_phrase(item) for item in numbered_items]

    semicolon_items = [normalize_pdf_child_phrase(item) for item in re.split(r"[；;]", normalized) if item.strip()]
    if len(semicolon_items) >= 2:
        return semicolon_items

    plain_series_items = [
        normalize_pdf_child_phrase(item)
        for item in re.split(r"[，、]", normalized)
        if item.strip()
    ]
    if len(plain_series_items) >= 2:
        return plain_series_items

    comma_items = split_comma_series(normalized)
    if len(comma_items) >= 2:
        return [normalize_pdf_child_phrase(item) for item in comma_items]

    slash_items = [normalize_pdf_child_phrase(item) for item in re.split(r"[/／]", normalized) if item.strip()]
    if len(slash_items) >= 2:
        return slash_items

    return [normalize_pdf_child_phrase(normalized)]


def dedupe_pdf_child_items(items: list[str]) -> list[str]:
    normalized_items: list[str] = []
    seen: set[str] = set()
    for item in items:
        cleaned = normalize_pdf_child_phrase(item)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized_items.append(cleaned)
    return normalized_items


def merge_duplicate_pdf_children(node: dict[str, Any]) -> dict[str, Any]:
    children = node.get("children") or []
    if not children:
        return node

    merged_children: list[dict[str, Any]] = []
    for child in children:
        child_text = clean_inline_text(child.get("text"))
        if merged_children and clean_inline_text(merged_children[-1].get("text")) == child_text:
            prior_children = merged_children[-1].get("children") or []
            next_children = child.get("children") or []
            merged_children[-1] = {
                **merged_children[-1],
                "children": prior_children + next_children,
            }
            continue
        merged_children.append(child)

    return {
        **node,
        "children": merged_children,
    }
