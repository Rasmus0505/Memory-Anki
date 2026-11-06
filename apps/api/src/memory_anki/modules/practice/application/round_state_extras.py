"""Directory-added palaces on a freestyle round.

「加入本轮」 widens the palace set without replacing it. These helpers keep the
config/card parsing out of the round state machine, which is already the
largest service in the practice module.
"""

from __future__ import annotations

from typing import Any

from memory_anki.core.time import local_day


def local_today() -> str:
    return local_day().isoformat()


def extra_palace_ids(config: dict[str, Any]) -> set[int]:
    """Palaces the learner explicitly added to this round's palace streams."""
    streams = config.get("streams")
    if not isinstance(streams, dict):
        return set()
    result: set[int] = set()
    for name in ("memory_palace", "quiz"):
        stream = streams.get(name)
        if not isinstance(stream, dict):
            continue
        for value in stream.get("extra_palace_ids") or []:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if number > 0:
                result.add(number)
    return result


def added_extra_palace_ids(previous: dict[str, Any], next_config: dict[str, Any]) -> set[int]:
    return extra_palace_ids(next_config) - extra_palace_ids(previous)


def card_palace_id(card: dict[str, Any]) -> int | None:
    raw = card.get("palace_id")
    if raw is None:
        context = card.get("palace_context")
        if isinstance(context, dict):
            raw = context.get("id")
    try:
        number = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None
    return number if number is not None and number > 0 else None


def extra_cards(cards: list[dict[str, Any]], added_ids: set[int]) -> list[dict[str, Any]]:
    """Only the newly joined palaces' cards; never the rest of the rebuild."""
    if not added_ids:
        return []
    return [card for card in cards if card_palace_id(card) in added_ids]
