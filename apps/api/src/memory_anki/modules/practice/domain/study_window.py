"""Cold-start prefix of an already ordered freestyle queue."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

STUDY_WINDOW_LIMIT = 8


def take_study_window(
    cards: Sequence[Mapping[str, Any]],
    *,
    limit: int = STUDY_WINDOW_LIMIT,
) -> list[dict[str, Any]]:
    """Prefix the learner can start: 8 cards, or the first palace boundary.

    Interleave A,B stops at 1. A palace of 3 followed by another palace returns
    3. A palace of 20 returns 8. The caller must use the same full order later
    so this prefix is not a reshuffle.
    """
    window: list[dict[str, Any]] = []
    first_palace: Any = None
    cap = max(1, int(limit))
    for card in cards:
        palace_id = card.get("palace_id")
        if not window:
            first_palace = palace_id
        elif palace_id != first_palace or len(window) >= cap:
            break
        window.append(dict(card))
        if len(window) >= cap:
            break
    return window


__all__ = ["STUDY_WINDOW_LIMIT", "take_study_window"]
