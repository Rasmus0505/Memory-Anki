"""睡前复习 plan rules: append today's rated cards and record plan-only grades.

Kept beside — not inside — ``round_plan.py`` so the round rules stay within the
project's module-size budget. These functions never touch the Reviews ledger.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .round_plan_normalization import normalize_plan, snapshot_cards
from .round_plan_values import _day, _int, _original_card, _text

Plan = dict[str, Any]
_RATINGS = {1, 2, 3, 4}


def bedtime_card_ids(plan: Mapping[str, Any]) -> set[str]:
    """Cards that were appended by 睡前复习 and must never reschedule."""
    return {
        item["card_id"]
        for item in normalize_plan(plan)["original_cards"]
        if item.get("bedtime")
    }


def append_bedtime_cards(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    today: str = "",
) -> tuple[Plan, list[str]]:
    """Append today's already-rated cards to the end of this round.

    The learner may tap 睡前复习 again after rating more cards; only the newly
    rated ones are appended. A card already in the round is moved to the end and
    its earlier pass in *this plan* is forgotten -- its reviews rating stays
    untouched, because that lives in the Reviews ledger. Returns the new plan and
    the appended card ids in order.
    """
    next_plan = normalize_plan(plan)
    stamp = _day(today)
    snapshots = snapshot_cards(cards, today=stamp)
    existing = {item["card_id"]: item for item in next_plan["original_cards"]}
    added: list[str] = []
    for snapshot in snapshots:
        card_id = snapshot["card_id"]
        if not snapshot.get("unit_id"):
            continue
        snapshot["bedtime"] = True
        if stamp:
            snapshot["entered_on"] = stamp
        for key in ("completed_ids", "excluded_ids", "compressed_ids"):
            next_plan[key] = [item for item in next_plan[key] if item != card_id]
        next_plan["encounters"].pop(card_id, None)
        next_plan["bedtime_ratings"].pop(card_id, None)
        next_plan["occurrences"] = [
            occ
            for occ in next_plan["occurrences"]
            if _text(occ.get("source_card_id")) != card_id
            and _text(occ.get("occurrence_id")) != card_id
        ]
        if card_id in existing:
            existing[card_id].update(snapshot)
        else:
            next_plan["original_cards"].append(snapshot)
            existing[card_id] = snapshot
        next_plan["presented_ids"] = [
            item for item in next_plan["presented_ids"] if item != card_id
        ]
        next_plan["presented_ids"].append(card_id)
        if card_id not in added:
            added.append(card_id)
    return normalize_plan(next_plan), added


def apply_bedtime_rating(
    plan: Mapping[str, Any],
    *,
    card_id: str,
    rating: int,
    today: str = "",
) -> Plan:
    """Record a bedtime pass without touching scheduling.

    The grade is kept on the plan so the rail and the card can show what the
    learner tapped; it is deliberately not written to the Reviews ledger, so the
    unit's due date and FSRS card stay exactly as they were.
    """
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    card = _original_card(next_plan, target)
    if card is None or not card.get("bedtime"):
        raise ValueError("bedtime card not found")
    value = _int(rating)
    if value not in _RATINGS:
        raise ValueError("rating must be 1-4")
    next_plan["bedtime_ratings"][target] = {"rating": value, "rated_on": _day(today)}
    if target not in next_plan["completed_ids"]:
        next_plan["completed_ids"].append(target)
    return normalize_plan(next_plan)


__all__ = ["append_bedtime_cards", "apply_bedtime_rating", "bedtime_card_ids"]
