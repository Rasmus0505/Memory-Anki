from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError


def normalize_optional_int(raw_value: Any) -> int | None:
    if raw_value in (None, "", 0, "0"):
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError) as exc:
        raise PalaceQuizValidationError("题目归属标识格式不正确。") from exc


__all__ = ["normalize_optional_int"]
