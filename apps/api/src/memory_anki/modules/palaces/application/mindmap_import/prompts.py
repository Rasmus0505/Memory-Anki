from __future__ import annotations

from .contracts import PROMPT_TEXT_MAX_CHARS
from memory_anki.modules.settings.application.ai_prompt_templates import (
    IMPORT_BATCH_MINDMAP_PROMPT,
    IMPORT_IMAGE_MINDMAP_PROMPT,
    IMPORT_IMAGE_TEXT_PROMPT,
    IMPORT_PDF_PAGE_CONTEXT_PROMPT,
)

PROMPT = IMPORT_IMAGE_MINDMAP_PROMPT

BATCH_PROMPT = IMPORT_BATCH_MINDMAP_PROMPT

TEXT_PROMPT = IMPORT_IMAGE_TEXT_PROMPT

PDF_PAGE_CONTEXT_PROMPT = IMPORT_PDF_PAGE_CONTEXT_PROMPT


def truncate_prompt_text(text: str, limit: int = PROMPT_TEXT_MAX_CHARS) -> str:
    normalized = str(text or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}\n\n[后续 OCR 文本已截断]"


def format_page_numbers(page_numbers: list[int] | None) -> str:
    if not page_numbers:
        return ""
    return "、".join(str(page) for page in page_numbers)
