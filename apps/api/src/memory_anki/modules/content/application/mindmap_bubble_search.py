"""Match the words written on mind-map bubbles, not article bodies or notes."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from memory_anki.modules.mindmap_document.api import plain_editor_text

_LIKE_ESCAPE = "\\"


def like_contains_pattern(query: str) -> str:
    escaped = (
        query.replace(_LIKE_ESCAPE, _LIKE_ESCAPE + _LIKE_ESCAPE)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )
    return f"%{escaped}%"


def iter_bubble_texts(editor_doc: Any) -> Iterator[str]:
    """Yield bubble labels in document order: root, then each branch top to bottom."""
    document = _load_document(editor_doc)
    root = document.get("root") if isinstance(document, dict) else None
    if not isinstance(root, dict):
        return
    yield from _walk_bubbles(root)


def first_matching_bubble_text(
    editor_doc: Any,
    query: str,
    *,
    skip_equal_to: str = "",
) -> str | None:
    """First bubble whose visible words contain the query.

    The palace title is skipped when it is the same sentence, so the hint under
    a row is a different line rather than a repeat of the name.
    """
    needle = query.casefold()
    if not needle:
        return None
    skipped = skip_equal_to.strip().casefold()
    for text in iter_bubble_texts(editor_doc):
        folded = text.casefold()
        if skipped and folded == skipped:
            continue
        if needle in folded:
            return text
    return None


def _load_document(editor_doc: Any) -> Any:
    if isinstance(editor_doc, str):
        try:
            return json.loads(editor_doc or "{}")
        except (TypeError, ValueError):
            return {}
    return editor_doc


def _walk_bubbles(node: dict[str, Any]) -> Iterator[str]:
    data = node.get("data")
    payload = data if isinstance(data, dict) else {}
    text = plain_editor_text(payload.get("text"), fallback="").strip()
    if text:
        yield text
    children = node.get("children")
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            yield from _walk_bubbles(child)
