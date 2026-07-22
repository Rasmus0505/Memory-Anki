from __future__ import annotations

import re
from html import escape
from typing import Any

from memory_anki.modules.produce.application.mindmap_ai_split.primitives import plain_text

from .text_splitting import clean_multiline_text
from .text_utils import clean_inline_text

# Product-side knowledge emphasis: yellow background, font color unchanged.
HIGHLIGHT_SPAN_OPEN = (
    '<span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">'
)
HIGHLIGHT_SPAN_CLOSE = "</span>"

# Textbook visual cues may arrive as legacy kinds; product maps all of them to highlight.
_LEGACY_EMPHASIS_KINDS = frozenset({"underline", "wavy-underline"})
_ALLOWED_EMPHASIS_KINDS = frozenset({"highlight", *_LEGACY_EMPHASIS_KINDS})

_SCRIPT_OR_EVENT_RE = re.compile(
    r"<\s*script\b[^>]*>.*?<\s*/\s*script\s*>|on\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)",
    re.IGNORECASE | re.DOTALL,
)
_DISALLOWED_TAG_RE = re.compile(
    r"</?(?!/?\s*(?:div|br|span|u|mark)\b)[a-zA-Z][^>]*>",
    re.IGNORECASE,
)


def normalize_emphasis_marks(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in _ALLOWED_EMPHASIS_KINDS:
            continue
        text = clean_inline_text(item.get("text"))
        if not text:
            continue
        # Product unified representation.
        normalized.append({"kind": "highlight", "text": text})
    return normalized


def to_rich_text_html(text: str) -> str:
    lines = [clean_inline_text(line) for line in str(text or "").split("\n")]
    normalized_lines = [line for line in lines if line]
    if not normalized_lines:
        return ""
    return "<div>" + "<br>".join(escape(line) for line in normalized_lines) + "</div>"


def sanitize_rich_text_html(value: Any) -> str:
    """Allow only simple mind-map rich text tags; strip scripts and event handlers."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    cleaned = _SCRIPT_OR_EVENT_RE.sub("", raw)
    cleaned = _DISALLOWED_TAG_RE.sub("", cleaned)
    return cleaned.strip()


def has_highlight_markup(value: Any) -> bool:
    html = str(value or "")
    return 'data-emphasis="highlight"' in html or "data-emphasis='highlight'" in html


def normalize_rich_text_html(
    value: Any,
    *,
    text: str,
    emphasis_marks: Any,
    preserve_line_breaks: bool,
) -> str:
    """Return rich HTML when marks/HTML exist; empty string when plain text is enough."""
    raw_html = sanitize_rich_text_html(value)
    if raw_html:
        return raw_html
    marks = normalize_emphasis_marks(emphasis_marks)
    if not marks:
        return ""
    return apply_emphasis_marks_to_html(text, marks, preserve_line_breaks=preserve_line_breaks)


def apply_emphasis_marks_to_html(text: str, emphasis_marks: Any, *, preserve_line_breaks: bool) -> str:
    normalized_text = clean_multiline_text(text)
    if not normalized_text:
        return ""
    html = (
        escape(normalized_text).replace("\n", "<br>")
        if preserve_line_breaks
        else escape(clean_inline_text(normalized_text.replace("\n", " ")))
    )
    marks = normalize_emphasis_marks(emphasis_marks)
    if not marks:
        return f"<div>{html}</div>"
    for mark in marks:
        marked_text = clean_inline_text(mark.get("text"))
        if not marked_text:
            continue
        escaped_marked_text = escape(marked_text)
        if escaped_marked_text not in html:
            continue
        replacement = f"{HIGHLIGHT_SPAN_OPEN}{escaped_marked_text}{HIGHLIGHT_SPAN_CLOSE}"
        html = html.replace(escaped_marked_text, replacement, 1)
    return f"<div>{html}</div>"


def html_to_plain_text(value: Any) -> str:
    return plain_text(value, fallback="")
