"""Pure value coercion helpers shared by the round-plan rules."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _day(value: Any) -> str:
    text = _text(value)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return ""


def _match_key(card: Mapping[str, Any]) -> str:
    unit_id = _text(card.get("unit_id"))
    if unit_id:
        return f"unit:{unit_id}"
    return f"card:{_text(card.get('card_id') or card.get('id'))}"


def _rewrite_ids(values: Sequence[Any], mapping: Mapping[str, str]) -> list[str]:
    rewritten: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = mapping.get(_text(raw), _text(raw))
        if not item or item in seen:
            continue
        seen.add(item)
        rewritten.append(item)
    return rewritten


def _append_unique(values: list[str], item: str) -> None:
    text = _text(item)
    if text and text not in values:
        values.append(text)


def _unique(values: Sequence[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = _text(raw)
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _text(value: Any) -> str:
    return str(value or "").strip()


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _palace_id(value: Any) -> int | None:
    try:
        number = int(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


def _find_occurrence(plan: Mapping[str, Any], occurrence_id: str) -> dict[str, Any] | None:
    target = _text(occurrence_id)
    if not target:
        return None
    for item in plan["occurrences"]:
        if item["occurrence_id"] == target:
            return item
    return None


def _original_card(plan: Mapping[str, Any], card_id: str) -> dict[str, Any] | None:
    target = _text(card_id)
    for item in plan["original_cards"]:
        if item["card_id"] == target:
            return item
    return None
