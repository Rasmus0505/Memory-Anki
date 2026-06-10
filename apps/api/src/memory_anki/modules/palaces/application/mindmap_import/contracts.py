from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class MindMapImportError(ValueError):
    pass


PDF_IMPORT_MODE_DIRECT_GENERATION = "direct_generation"
PDF_IMPORT_MODE_STRUCTURED_MERGE = "structured_merge"


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


@dataclass
class PdfImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    selected_pages: list[int]
    structure_page: int | None = None
    match_mode: str = "strict_match"
    can_apply: bool = True
    warnings: list[str] | None = None
    ocr_grounding_used: bool | None = None
    ocr_text_chars: int | None = None


@dataclass
class PdfImportOptions:
    quote_original_text_only: bool = True
    mount_on_original_leaf_only: bool = True
    preserve_emphasis_marks: bool = True
    semantic_split_long_paragraphs: bool = True
    preserve_line_breaks: bool = True


@dataclass
class PdfTextPreviewResult:
    extracted_text: str
    selected_pages: list[int]


PROMPT_TEXT_MAX_CHARS = 12000
SINGLE_PAGE_PDF_WARNING = "仅选择了 1 页 PDF，本次只恢复结构页脑图，未补充正文内容。"
PDF_OCR_FALLBACK_WARNING = "未获得稳定的 OCR 正文，本次会继续根据结构页和正文图片尝试补全。"
PDF_DIRECT_OCR_FALLBACK_WARNING = "未获得稳定的 OCR 正文，本次将继续根据页面图片直接生成脑图，正文补全可信度可能下降。"


ImportStreamEvent = dict[str, Any]
