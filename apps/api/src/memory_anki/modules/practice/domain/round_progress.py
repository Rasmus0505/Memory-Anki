"""Read-only progress projection for a freestyle round plan.

`round_progress` answers every "where am I / how much is left" question from
one place. The persisted plan stays the mutable command state owned by the
rating and retry rules; this module only reads it.

Why a projection instead of more frontend derivation
----------------------------------------------------
The feedback rail, the round sheet and the settlement page each used to
recount the same plan with slightly different inputs. One of them forgot the
wrong-unit set and drew different ticks from the rail. A single server-side
projection with the same inputs on every read makes those surfaces agree by
construction.

Contract:
- pure: never mutates the input mapping, never touches the database;
- no new persisted state: it is attached to the existing round payload, so its
  ``plan_version`` can never disagree with the plan it describes;
- ``viewing`` is deliberately absent. What the learner is looking at is a
  client-side instant, not part of the stored round.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .round_compress import compressible_ids
from .round_plan import (
    FAIL_RATINGS,
    next_unfinished_id,
    plan_is_fully_handled,
)
from .round_plan_fail import _occurrence_owns_score
from .round_plan_intraday import plan_waiting
from .round_plan_normalization import (
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    normalize_plan,
)
from .round_plan_values import _int, _text

STATUS_DONE = "done"
STATUS_PENDING = "pending"
STATUS_EXCLUDED = "excluded"
STATUS_COMPRESSED = "compressed"


def _waiting_occurrence_ids(plan: Mapping[str, Any]) -> set[str]:
    """Occurrences still owed today but not yet servable.

    Mirrors ``round_plan_intraday._waiting_occurrences`` without exposing that
    private iterator: a pending retry is owed work, and an inserted retry the
    learner already rated 忘记 stays on the rail until its next attempt is due.
    """
    result: set[str] = set()
    for item in plan.get("occurrences") or []:
        if not isinstance(item, Mapping) or not item.get("available_at"):
            continue
        status = item.get("status")
        if status == OCCURRENCE_PENDING:
            result.add(_text(item.get("occurrence_id")))
        elif status == OCCURRENCE_INSERTED and _int(item.get("rating")) in FAIL_RATINGS:
            result.add(_text(item.get("occurrence_id")))
    return result


def _servable(
    plan: Mapping[str, Any],
    card_id: str,
    occurrence: Mapping[str, Any] | None,
    *,
    excluded: set[str],
    compressed: set[str],
    live_sources: set[str],
) -> bool:
    """Whether this card is part of the work the learner can open right now."""
    if card_id in excluded or card_id in compressed:
        return False
    if occurrence is not None:
        return occurrence.get("status") == OCCURRENCE_INSERTED
    return card_id not in live_sources


def project_round_progress(
    plan: Mapping[str, Any] | None,
    *,
    plan_version: int | None = None,
    quiz_all_correct_unit_ids: set[str] | None = None,
    quiz_wrong_unit_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Return the single progress read model for one round plan.

    ``quiz_wrong_unit_ids`` is the current-answer snapshot: a corrected question
    stops painting its unit red even though the plan keeps the unit in its
    cumulative ``wrong_unit_ids`` for queue priority. Callers that do not supply
    it fall back to the plan's cumulative set.
    """
    normalized = normalize_plan(plan)
    presented = list(normalized["presented_ids"])
    completed = set(normalized["completed_ids"])
    excluded = set(normalized["excluded_ids"])
    compressed = set(normalized["compressed_ids"])
    originals = {item["card_id"]: item for item in normalized["original_cards"]}
    occurrences = {
        item["occurrence_id"]: item
        for item in normalized["occurrences"]
        if item.get("occurrence_id")
    }
    waiting = _waiting_occurrence_ids(normalized)
    live_sources = {
        _text(item.get("source_card_id"))
        for item in normalized["occurrences"]
        if isinstance(item, Mapping)
        and item.get("status") in {OCCURRENCE_INSERTED, "completed"}
    }
    priority_wrong_units = set(normalized["wrong_unit_ids"])
    wrong_units = (
        {_text(item) for item in quiz_wrong_unit_ids if _text(item)}
        if quiz_wrong_unit_ids is not None
        else priority_wrong_units
    )
    correct_units = {
        _text(item) for item in (quiz_all_correct_unit_ids or set()) if _text(item)
    } - wrong_units
    current = normalized["current_card_id"]
    base_ids = [item["card_id"] for item in normalized["original_cards"]]
    current_index = presented.index(current) if current in presented else -1

    items: list[dict[str, Any]] = []
    for card_id in presented:
        source = originals.get(card_id)
        occurrence = occurrences.get(card_id)
        if source is None and occurrence is None:
            # A presented id with neither snapshot nor occurrence is stale
            # bookkeeping; leave it out instead of inventing a card.
            continue
        parent = originals.get(_text(occurrence.get("source_card_id"))) if occurrence else None
        unit_id = _text(
            source.get("unit_id")
            if source is not None
            else (occurrence.get("source_unit_id") if occurrence else "")
        ) or _text(parent.get("unit_id") if parent else "")
        palace_id = (source or parent or {}).get("palace_id")
        kind = _text((source or parent or {}).get("kind")) or "card"
        entered_on = _text(
            (occurrence or source or {}).get("entered_on")
        ) or _text((parent or {}).get("entered_on"))
        if card_id in compressed:
            status = STATUS_COMPRESSED
        elif card_id in excluded:
            status = STATUS_EXCLUDED
        elif card_id in completed:
            status = STATUS_DONE
        else:
            status = STATUS_PENDING
        encounter = normalized["encounters"].get(card_id)
        own_rating = None
        if isinstance(encounter, Mapping):
            rating = _int(encounter.get("rating"))
            if rating in {1, 2, 3, 4}:
                if occurrence is None or _occurrence_owns_score(normalized, occurrence):
                    own_rating = rating
        tone = "done" if status == STATUS_DONE else (
            "retry" if occurrence is not None and occurrence.get("status") == OCCURRENCE_INSERTED else "pending"
        )
        items.append(
            {
                "card_id": card_id,
                "source_card_id": _text(occurrence.get("source_card_id")) if occurrence else card_id,
                "occurrence_kind": "source" if occurrence is None else _text(occurrence.get("kind")) or "retry",
                "retry_attempt": _int(occurrence.get("retry_attempt")) if occurrence else 0,
                "unit_id": unit_id,
                "palace_id": palace_id,
                "kind": kind,
                "entered_on": entered_on,
                "is_new": bool((source or parent or {}).get("is_new")),
                "bedtime": bool((source or parent or {}).get("bedtime")),
                "is_quiz": kind == "quiz_question",
                "status": status,
                "tone": tone,
                "scored": own_rating is not None,
                "own_rating": own_rating,
                "waiting_retry": card_id in waiting,
                "available_at": _text(occurrence.get("available_at")) if occurrence else None,
                "servable": _servable(
                    normalized,
                    card_id,
                    occurrence,
                    excluded=excluded,
                    compressed=compressed,
                    live_sources=live_sources,
                ),
                "wrong": bool(unit_id and unit_id in wrong_units),
                "quiz_all_correct": bool(unit_id and unit_id in correct_units),
            }
        )

    current_source_id = current
    if current in occurrences:
        current_source_id = _text(occurrences[current].get("source_card_id"))
    position_base = (
        base_ids.index(current_source_id) + 1
        if current_source_id in base_ids
        else 0
    )
    done_count = sum(1 for item in items if item["status"] == STATUS_DONE)
    retry_items = [item for item in items if item["occurrence_kind"] in {"retry", "step"}]
    waiting_meta = plan_waiting(normalized)

    return {
        "plan_version": plan_version,
        "current_card_id": current,
        "current_index": current_index,
        "position": current_index + 1 if current_index >= 0 else 0,
        "position_base": position_base,
        "total": len(items),
        "scheduled_base": len(base_ids),
        "done_count": done_count,
        "retry_count": len(retry_items),
        "retry_inserted": sum(1 for item in retry_items if item["tone"] == "retry"),
        "passed_count": sum(1 for item in items if item["own_rating"] in {2, 3, 4}),
        "next_unfinished_id": next_unfinished_id(normalized),
        "fully_handled": plan_is_fully_handled(normalized),
        "waiting": {
            "count": int(waiting_meta.get("count") or 0),
            "next_ready_at": waiting_meta.get("next_ready_at"),
        },
        "compressible_ids": compressible_ids(normalized),
        "wrong_unit_ids": sorted(wrong_units),
        "items": items,
    }
