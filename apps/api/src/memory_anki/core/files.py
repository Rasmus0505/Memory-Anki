from __future__ import annotations


def safe_filename_part(value: object, *, fallback: str = "item") -> str:
    text = str(value or "").strip()
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in text)
    safe = safe.strip("-_")
    return safe or fallback
