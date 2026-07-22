from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.core.prompt_text import PROMPT_TEXT_MAX_CHARS as _PROMPT_TEXT_MAX_CHARS

PROMPT_TEXT_MAX_CHARS = _PROMPT_TEXT_MAX_CHARS


class MindMapImportError(ValueError):
    pass


@dataclass
class ImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    review_preview: dict[str, Any] | None = None


@dataclass
class TextPreviewResult:
    extracted_text: str


@dataclass
class BatchImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    image_count: int
    review_preview: dict[str, Any] | None = None


ImportStreamEvent = dict[str, Any]
