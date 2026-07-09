from __future__ import annotations

from html import escape
from typing import Any

from memory_anki.modules.palaces.application.mindmap_ai_split.primitives import plain_text

from .text_splitting import clean_multiline_text
from .text_utils import clean_inline_text


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
    return plain_text(value, fallback="")
