from __future__ import annotations

import re
import uuid
from html import escape, unescape
from typing import Any

from memory_anki.modules.mindmap.application.editor_state_service import normalize_editor_doc

from .contracts import MindMapImportError
from .model_io import (
    ERROR_SNIPPET_LIMIT as ERROR_SNIPPET_LIMIT,
)
from .model_io import (
    MAX_IMAGE_BYTES as MAX_IMAGE_BYTES,
)
from .model_io import (
    build_image_content_part as build_image_content_part,
)
from .model_io import (
    build_pdf_text_anchors as build_pdf_text_anchors,
)
from .model_io import (
    ensure_rendered_page_size as ensure_rendered_page_size,
)
from .model_io import (
    normalize_extracted_text as normalize_extracted_text,
)
from .model_io import (
    normalize_page_selection as normalize_page_selection,
)
from .model_io import (
    parse_source_tree_json as parse_source_tree_json,
)
from .model_io import (
    split_prompt_anchor_parts as split_prompt_anchor_parts,
)
from .model_io import (
    summarize_model_output as summarize_model_output,
)
from .model_io import (
    trim_pdf_extracted_text as trim_pdf_extracted_text,
)
from .text_utils import clean_inline_text as clean_inline_text

MAX_NODE_COUNT = 400
NODE_WRAP_WIDTH = 38
NODE_WRAP_MIN_WIDTH = 10
LONG_NODE_SPLIT_THRESHOLD = 72
MAX_SPLIT_CHILDREN = 8
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
    normalized_children = [
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


def normalize_emphasis_marks(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in {"underline", "wavy-underline"}:
            continue
        text = clean_inline_text(item.get("text"))
        if not text:
            continue
        normalized.append({"kind": kind, "text": text})
    return normalized


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
    rich_text_html = source_node.get("rich_text_html")
    has_rich_text = isinstance(rich_text_html, str) and rich_text_html != ""
    data: dict[str, Any] = {
        "uid": uuid.uuid4().hex,
        "text": rich_text_html if has_rich_text else source_node["text"],
    }
    if has_rich_text:
        data["richText"] = True
    return {
        "data": data,
        "children": [
            source_node_to_editor_node(child, preserve_line_breaks=preserve_line_breaks)
            for child in source_node["children"]
        ],
    }


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


def to_rich_text_html(text: str) -> str:
    lines = [clean_inline_text(line) for line in str(text or "").split("\n")]
    normalized_lines = [line for line in lines if line]
    if not normalized_lines:
        return ""
    return "<div>" + "<br>".join(escape(line) for line in normalized_lines) + "</div>"


def normalize_rich_text_html(
    value: Any,
    *,
    text: str,
    emphasis_marks: Any,
    preserve_line_breaks: bool,
) -> str:
    raw_html = str(value or "").strip()
    if raw_html:
        return raw_html
    return apply_emphasis_marks_to_html(text, emphasis_marks, preserve_line_breaks=preserve_line_breaks)


def apply_emphasis_marks_to_html(text: str, emphasis_marks: Any, *, preserve_line_breaks: bool) -> str:
    normalized_text = clean_multiline_text(text)
    if not normalized_text:
        return ""
    html = (
        escape(normalized_text).replace("\n", "<br>")
        if preserve_line_breaks
        else escape(clean_inline_text(normalized_text.replace("\n", " ")))
    )
    if not isinstance(emphasis_marks, list):
        return f"<div>{html}</div>"
    for mark in emphasis_marks:
        if not isinstance(mark, dict):
            continue
        marked_text = clean_inline_text(mark.get("text"))
        if not marked_text:
            continue
        escaped_marked_text = escape(marked_text)
        if mark.get("kind") == "wavy-underline":
            replacement = (
                "<span style=\"text-decoration-line: underline;"
                " text-decoration-style: wavy; text-decoration-color: currentColor;\">"
                f"{escaped_marked_text}</span>"
            )
        else:
            replacement = f"<u>{escaped_marked_text}</u>"
        html = html.replace(escaped_marked_text, replacement, 1)
    return f"<div>{html}</div>"


def html_to_plain_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(?:div|p|li|h[1-6]|blockquote|pre|tr)>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


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
