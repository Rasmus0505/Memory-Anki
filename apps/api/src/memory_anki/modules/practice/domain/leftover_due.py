"""Per-palace leftover due counts for freestyle chapter copy."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def leftover_due_by_palace(
    remaining: Sequence[Mapping[str, Any]],
    scheduled: Sequence[Mapping[str, Any]],
) -> dict[str, int]:
    """Count today's due review units that did not fit this round, per palace.

    Fill / quiz cards are not today's palace schedule. Keys are palace id strings
    so the JSON envelope stays stable for the frontend.
    """
    scheduled_ids = {str(card.get("id") or "") for card in scheduled if card.get("id")}
    leftover: dict[str, int] = {}
    for card in remaining:
        card_id = str(card.get("id") or "")
        if not card_id or card_id in scheduled_ids:
            continue
        if str(card.get("type") or "") != "mindmap_branch":
            continue
        if str(card.get("phase") or "") != "due":
            continue
        if not card.get("unit_id"):
            continue
        palace_id = int(card.get("palace_id") or 0)
        if palace_id <= 0:
            continue
        key = str(palace_id)
        leftover[key] = leftover.get(key, 0) + 1
    return leftover


def merge_leftover_due(*maps: Mapping[str, Any] | None) -> dict[str, int]:
    merged: dict[str, int] = {}
    for raw in maps:
        if not isinstance(raw, Mapping):
            continue
        for key, value in raw.items():
            palace_id = str(key)
            try:
                count = int(value or 0)
            except (TypeError, ValueError):
                continue
            if not palace_id or count <= 0:
                continue
            merged[palace_id] = merged.get(palace_id, 0) + count
    return merged
