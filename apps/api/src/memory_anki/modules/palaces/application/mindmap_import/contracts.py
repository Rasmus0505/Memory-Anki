from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.core.prompt_text import PROMPT_TEXT_MAX_CHARS


class MindMapImportError(ValueError):
    pass


@dataclass
class ImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]


@dataclass
class TextPreviewResult:
    extracted_text: str


@dataclass
class BatchImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    structure_image_index: int | None
    image_count: int


ImportStreamEvent = dict[str, Any]
