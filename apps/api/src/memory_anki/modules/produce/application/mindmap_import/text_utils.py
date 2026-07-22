from __future__ import annotations

from typing import Any


def clean_inline_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\u3000", " ").split()).strip()
