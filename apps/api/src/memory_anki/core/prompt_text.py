from __future__ import annotations

PROMPT_TEXT_MAX_CHARS = 12000


def truncate_prompt_text(text: str, limit: int = PROMPT_TEXT_MAX_CHARS) -> str:
    normalized = str(text or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}\n\n[后续 OCR 文本已截断]"


def format_page_numbers(page_numbers: list[int] | None) -> str:
    if not page_numbers:
        return ""
    return "、".join(str(page) for page in page_numbers)
