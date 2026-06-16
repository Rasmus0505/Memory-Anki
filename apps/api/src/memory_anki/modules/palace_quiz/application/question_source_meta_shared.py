from __future__ import annotations

from typing import Any


def normalize_optional_int(raw_value: Any) -> int | None:
    try:
        return int(raw_value) if raw_value not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def normalize_optional_string(raw_value: Any) -> str | None:
    return str(raw_value or "").strip() or None


def normalize_positive_int_list(raw_values: Any) -> list[int] | None:
    if not isinstance(raw_values, list):
        return None
    normalized_values: set[int] = set()
    for item in raw_values:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value > 0:
            normalized_values.add(value)
    return sorted(normalized_values) or None


def normalize_non_empty_string_list(raw_values: Any) -> list[str] | None:
    if not isinstance(raw_values, list):
        return None
    normalized_values = [
        normalized
        for item in raw_values
        if item is not None
        for normalized in [str(item).strip()]
        if normalized
    ]
    return normalized_values or None


__all__ = [
    "normalize_non_empty_string_list",
    "normalize_optional_int",
    "normalize_optional_string",
    "normalize_positive_int_list",
]
