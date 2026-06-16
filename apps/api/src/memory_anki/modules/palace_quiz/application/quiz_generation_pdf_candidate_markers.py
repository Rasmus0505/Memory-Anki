"""PDF candidate text normalization and chapter marker extraction."""

from __future__ import annotations

import re
from typing import Any

_PDF_CHAPTER_MARKER_PATTERN = re.compile(r"第\s*[0-9一二三四五六七八九十百千两]+\s*[章节目部分篇讲课单元]")


def normalize_pdf_marker_text(value: Any) -> str:
    return "".join(str(value or "").strip().lower().split())


def extract_chapter_markers_from_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    markers: list[str] = []
    seen: set[str] = set()
    for match in _PDF_CHAPTER_MARKER_PATTERN.findall(text):
        normalized = normalize_pdf_marker_text(match)
        if normalized and normalized not in seen:
            seen.add(normalized)
            markers.append(str(match).strip())
    compact = text if len(text) <= 40 else ""
    normalized_compact = normalize_pdf_marker_text(compact)
    if compact and normalized_compact and normalized_compact not in seen:
        seen.add(normalized_compact)
        markers.append(compact)
    return markers


__all__ = [
    "extract_chapter_markers_from_text",
    "normalize_pdf_marker_text",
]
