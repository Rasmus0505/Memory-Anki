"""Pure deterministic merger for independently configured freestyle streams."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .quiz_stream import stable_mix


def merge_content_streams(
    streams: Mapping[str, Sequence[dict[str, Any]]],
    *,
    active_streams: Sequence[str],
    strategy: str,
    ratios: Mapping[str, int],
    seed: int,
) -> list[dict[str, Any]]:
    """Merge memory-palace, quiz, and English streams without duplicate cards."""
    ordered_names = [name for name in active_streams if name in streams]
    if not ordered_names:
        return []

    queues = {
        name: [dict(card) for card in streams.get(name, ())]
        for name in ordered_names
    }
    if strategy == "sequential":
        candidates = [card for name in ordered_names for card in queues[name]]
    elif strategy == "random":
        candidates = [card for name in ordered_names for card in queues[name]]
        candidates.sort(
            key=lambda card: (
                stable_mix(seed, "content-stream", card.get("id")),
                str(card.get("id") or ""),
            )
        )
    else:
        credits = {name: 0 for name in ordered_names}
        candidates = []
        while any(queues[name] for name in ordered_names):
            if not any(credits.values()):
                for name in ordered_names:
                    credits[name] = max(1, int(ratios.get(name, 1))) if queues[name] else 0
            available = [name for name in ordered_names if queues[name] and credits[name] > 0]
            if not available:
                for name in ordered_names:
                    credits[name] = 0
                continue
            name = max(
                available,
                key=lambda item: (credits[item], -ordered_names.index(item)),
            )
            candidates.append(queues[name].pop(0))
            credits[name] -= 1

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for card in candidates:
        card_id = str(card.get("id") or "")
        if not card_id or card_id in seen:
            continue
        seen.add(card_id)
        result.append(card)
    return result


__all__ = ["merge_content_streams"]
