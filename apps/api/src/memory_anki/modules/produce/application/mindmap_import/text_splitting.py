from __future__ import annotations

import re
from typing import Any

from .text_utils import clean_inline_text

NODE_WRAP_WIDTH = 38
NODE_WRAP_MIN_WIDTH = 10
LONG_NODE_SPLIT_THRESHOLD = 72
MAX_SPLIT_CHILDREN = 8
ABSTRACT_SPLIT_HEADINGS = (
    "特点",
    "内容",
    "类型",
    "分类",
    "比较",
    "对比",
    "区别",
    "联系",
    "作用",
    "意义",
    "方法",
    "形式",
    "原则",
    "制度",
    "目标",
)


def clean_multiline_text(value: Any) -> str:
    text = str(value or "").replace("\u3000", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [clean_inline_text(line) for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def format_node_text_for_card(value: Any, *, preserve_line_breaks: bool) -> str:
    text = clean_multiline_text(value)
    if not text:
        return ""
    if preserve_line_breaks:
        preserved_lines: list[str] = []
        for line in text.split("\n"):
            preserved_lines.extend(wrap_node_line(line))
        return "\n".join(part for part in preserved_lines if part).strip()
    wrapped_lines: list[str] = []
    wrapped_lines.extend(wrap_node_line(clean_inline_text(text.replace("\n", " "))))
    return "\n".join(part for part in wrapped_lines if part).strip()


def split_overlong_leaf_node(text: str) -> dict[str, Any] | None:
    normalized_text = clean_multiline_text(text)
    compact_text = clean_inline_text(normalized_text.replace("\n", " "))
    heading, body = split_heading_and_body(compact_text)
    if not heading or not body:
        return None

    items = extract_parallel_items(body)
    if len(items) < 2:
        return None
    if (
        len(compact_text) < LONG_NODE_SPLIT_THRESHOLD
        and len(items) < 3
        and max(len(item) for item in items) < 24
        and not is_abstract_heading(heading)
    ):
        return None

    trimmed_items = [clean_multiline_text(item) for item in items[:MAX_SPLIT_CHILDREN]]
    trimmed_items = [item for item in trimmed_items if item]
    if len(trimmed_items) < 2:
        return None

    return {
        "text": heading,
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": [{"text": item, "children": []} for item in trimmed_items],
    }


def promote_single_verbose_child(node: dict[str, Any]) -> dict[str, Any] | None:
    children = node.get("children") or []
    if len(children) != 1:
        return None
    only_child = children[0]

    parent_text = clean_inline_text(node.get("text"))
    child_text = clean_multiline_text(only_child.get("text"))
    if not parent_text or not child_text:
        return None

    child_children = only_child.get("children") or []
    if child_children:
        child_heading = clean_inline_text(only_child.get("text"))
        if child_heading == parent_text or is_abstract_heading(parent_text):
            return {
                "text": parent_text,
                "rich_text_html": None,
                "emphasis_marks": [],
                "children": child_children,
            }
        return None

    split_child = split_overlong_leaf_node(child_text)
    if split_child and split_child.get("children"):
        return {
            "text": parent_text,
            "rich_text_html": None,
            "emphasis_marks": [],
            "children": split_child["children"],
        }

    direct_items = extract_parallel_items(child_text)
    direct_items = [clean_multiline_text(item) for item in direct_items[:MAX_SPLIT_CHILDREN]]
    direct_items = [item for item in direct_items if item]
    if len(direct_items) >= 3:
        return {
            "text": parent_text,
            "rich_text_html": None,
            "emphasis_marks": [],
            "children": [{"text": item, "children": []} for item in direct_items],
        }

    if not is_abstract_heading(parent_text):
        return None

    body = child_text
    if "：" in child_text or ":" in child_text:
        heading, tail = split_heading_and_body(child_text)
        if heading and tail:
            if clean_inline_text(heading) == parent_text:
                body = tail
            elif is_abstract_heading(heading):
                body = tail
    items = extract_parallel_items(body)
    trimmed_items = [clean_multiline_text(item) for item in items[:MAX_SPLIT_CHILDREN]]
    trimmed_items = [item for item in trimmed_items if item]
    if len(trimmed_items) < 2:
        return None
    return {
        "text": parent_text,
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": [{"text": item, "children": []} for item in trimmed_items],
    }


def wrap_node_line(line: str) -> list[str]:
    text = clean_inline_text(line)
    if not text:
        return []
    parts: list[str] = []
    remaining = text
    while len(remaining) > NODE_WRAP_WIDTH:
        split_at = find_wrap_index(remaining)
        parts.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()
    if remaining:
        parts.append(remaining)
    return parts


def split_heading_and_body(text: str) -> tuple[str | None, str | None]:
    normalized = clean_inline_text(text)
    if not normalized:
        return None, None

    for delimiter in ("：", ":"):
        if delimiter not in normalized:
            continue
        head, tail = normalized.split(delimiter, 1)
        clean_head = clean_inline_text(head)
        clean_tail = clean_inline_text(tail)
        if 2 <= len(clean_head) <= 28 and clean_tail:
            return clean_head, clean_tail

    marker_positions = [
        match.start()
        for match in re.finditer(
            r"(?:\d+[.、]|[（(][0-9一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、)",
            normalized,
        )
        if match.start() >= 6
    ]
    if marker_positions:
        first_marker = marker_positions[0]
        head = clean_inline_text(normalized[:first_marker])
        tail = clean_inline_text(normalized[first_marker:])
        if 2 <= len(head) <= 28 and tail:
            return head, tail
    return None, None


def extract_parallel_items(text: str) -> list[str]:
    normalized = clean_inline_text(text)
    if not normalized:
        return []

    numbered_items = split_numbered_items(normalized)
    if len(numbered_items) >= 2:
        return numbered_items

    semicolon_items = [clean_inline_text(item) for item in re.split(r"[；;]", normalized) if item.strip()]
    if len(semicolon_items) >= 2:
        return semicolon_items

    comma_items = split_comma_series(normalized)
    if len(comma_items) >= 3:
        return comma_items

    sentence_items = [
        clean_inline_text(item)
        for item in re.split(r"(?<=[。！？!?])", normalized)
        if item.strip()
    ]
    if len(sentence_items) >= 3 and all(len(item) <= 38 for item in sentence_items):
        return sentence_items
    return []


def split_numbered_items(text: str) -> list[str]:
    marker_pattern = re.compile(
        r"(?:\d+[.、]|[（(][0-9一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、)"
    )
    matches = list(marker_pattern.finditer(text))
    if len(matches) < 2:
        return []

    items: list[str] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        item = clean_inline_text(text[start:end])
        if item:
            items.append(item)
    return items


def split_comma_series(text: str) -> list[str]:
    normalized = clean_inline_text(text)
    if not normalized:
        return []
    if any(marker in normalized for marker in ("。", "；", ";", "！", "？", "?", "!")):
        return []
    parts = [clean_inline_text(item) for item in re.split(r"[，、]", normalized) if item.strip()]
    if len(parts) < 3:
        return []
    if any(len(item) > 26 for item in parts):
        return []
    return parts


def is_abstract_heading(text: str) -> bool:
    normalized = clean_inline_text(text)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in ABSTRACT_SPLIT_HEADINGS)


def find_wrap_index(text: str) -> int:
    search_end = min(len(text), NODE_WRAP_WIDTH)
    snippet = text[:search_end]
    marker_match = None
    for pattern in (
        r"(?<!^)(?=第[一二三四五六七八九十百千万0-9]+[章节部分课])",
        r"(?<!^)(?=[0-9]+[.、])",
        r"(?<!^)(?=[（(][一二三四五六七八九十百千万0-9]+[)）])",
        r"(?<!^)(?=[一二三四五六七八九十百千万]+、)",
    ):
        candidate = re.search(pattern, snippet)
        if candidate and candidate.start() >= NODE_WRAP_MIN_WIDTH:
            marker_match = candidate.start()
    if marker_match:
        return marker_match

    for punctuation in ("；", "。", "：", "，", "、", ";", ":", ",", "!", "！", "?", "？"):
        index = snippet.rfind(punctuation)
        if index >= NODE_WRAP_MIN_WIDTH:
            return index + 1

    whitespace_index = snippet.rfind(" ")
    if whitespace_index >= NODE_WRAP_MIN_WIDTH:
        return whitespace_index + 1
    return search_end
