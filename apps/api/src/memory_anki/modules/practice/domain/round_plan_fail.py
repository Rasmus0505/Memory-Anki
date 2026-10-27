"""Failed-glance transitions for a freestyle round plan.

A 忘记/困难 rating does not mint an endless stream of copies: it keeps one
occurrence slot per source, books its wait, and marks the previous glance's
score as history. Kept out of ``round_plan.py`` so the plan algebra stays under
its size budget; ``round_plan`` imports these helpers lazily to avoid a cycle.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .round_plan import (
    OCCURRENCE_CANCELLED,
    OCCURRENCE_COMPLETED,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    Plan,
    _cohort_of,
    _collapse_retries,
    _insert_retry_inplace,
    _int,
    _max_attempt,
    _predicted_insert_index,
    _sync_index,
    _text,
    occurrence_id_for,
)


def _occurrence_owns_score(plan: Mapping[str, Any], occ: Mapping[str, Any] | None) -> bool:
    """True when this occurrence was scored by its own encounter.

    An occurrence created by a parent's 忘记/困难 carries the parent's encounter
    id in ``encounter_id`` but has no entry of its own in ``encounters``. Any
    later read must treat it as unrated; only a matching pair means the score
    belongs to this glance.
    """
    if not occ:
        return False
    occ_id = _text(occ.get("occurrence_id"))
    own = _text(occ.get("encounter_id"))
    if not occ_id or not own:
        return False
    enc = plan.get("encounters", {}).get(occ_id)
    if not isinstance(enc, Mapping):
        return False
    return _text(enc.get("encounter_id")) == own


def _revive_occurrence(plan: Plan, occ: Mapping[str, Any]) -> None:
    item = occ if isinstance(occ, dict) else None
    if item is None or item.get("status") != OCCURRENCE_COMPLETED:
        return
    occ_id = _text(item.get("occurrence_id"))
    item["status"] = OCCURRENCE_INSERTED if occ_id in plan["presented_ids"] else OCCURRENCE_PENDING
    plan["completed_ids"] = [entry for entry in plan["completed_ids"] if entry != occ_id]


def _publish_pending_retries(plan: Plan, source_id: str) -> None:
    """Put a weak rating's retry on the rail now. Do not move ``current_card_id``."""
    source_id = _text(source_id)
    if not source_id:
        return
    held_current = plan.get("current_card_id")
    presented = plan["presented_ids"]
    if source_id in presented:
        anchor = presented.index(source_id)
    else:
        current = _text(plan.get("current_card_id"))
        anchor = presented.index(current) if current and current in presented else int(plan.get("current_index") or 0)
    for item in list(plan["occurrences"]):
        if _text(item.get("source_card_id")) != source_id:
            continue
        if item.get("status") != OCCURRENCE_PENDING:
            continue
        if item.get("available_at"):
            # Time-spaced: stays off the rail until publish_ready_retries runs.
            continue
        _insert_retry_inplace(plan, _text(item.get("occurrence_id")), anchor)
    if held_current and _text(held_current) in plan["presented_ids"]:
        plan["current_card_id"] = held_current
    _sync_index(plan)


def _fail_source(
    plan: Plan,
    *,
    source_id: str,
    source_unit_id: str,
    encounter_id: str,
    rating: int,
    round_id: str,
    occ: dict[str, Any] | None,
    available_at: datetime | None = None,
    kind: str = "retry",
    rated_card_id: str = "",
    rated_new_glance: bool = False,
) -> None:
    next_available = available_at.isoformat() if available_at else None
    rows = [item for item in plan["occurrences"] if item["source_card_id"] == source_id]
    same = [item for item in plan["occurrences"] if item["encounter_id"] == encounter_id and item["status"] != OCCURRENCE_CANCELLED]
    if same:
        for item in same:
            item["rating"] = rating
            item["available_at"] = next_available
            item["kind"] = kind
            _revive_occurrence(plan, item)
        _collapse_retries(plan)
        _publish_pending_retries(plan, source_id)
        return
    live = [item for item in rows if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}]
    completed = [item for item in rows if item["status"] == OCCURRENCE_COMPLETED]
    keep = occ if occ is not None and occ in live else (live[0] if live else None)
    if keep is None and completed:
        keep = occ if occ is not None and occ in completed else max(completed, key=lambda item: int(item.get("retry_attempt") or 0))
        _revive_occurrence(plan, keep)
    if keep is not None:
        keep_occ_id = _text(keep.get("occurrence_id"))
        rated_is_keep = bool(keep_occ_id) and keep_occ_id == _text(rated_card_id)
        if rated_is_keep:
            new_glance = rated_new_glance
        else:
            # The parent's weak score schedules this glance, not its own score.
            # A rated retry slot reused for a new attempt must look unrated, and
            # its old encounter must not make it pass for answered.
            new_glance = bool(
                _occurrence_owns_score(plan, keep)
                and _text(keep.get("encounter_id"))
                and _text(keep.get("encounter_id")) != encounter_id
            )
            if keep_occ_id:
                plan["encounters"].pop(keep_occ_id, None)
        keep["rating"] = rating
        keep["encounter_id"] = encounter_id
        keep["available_at"] = next_available
        keep["kind"] = kind
        if keep["status"] == OCCURRENCE_INSERTED and new_glance:
            # Each new glance increments the same slot; the id is stable.
            keep["retry_attempt"] = max(1, _int(keep.get("retry_attempt"))) + 1
        if keep["status"] == OCCURRENCE_PENDING:
            keep["retry_attempt"] = int(keep["retry_attempt"] or 0) + 1
            keep["occurrence_id"] = occurrence_id_for(round_id, keep["source_unit_id"] or source_unit_id or source_id, keep["retry_attempt"])
            keep["insert_target_index"] = _predicted_insert_index(plan, source_id)
        elif keep["status"] != OCCURRENCE_INSERTED:
            keep["retry_attempt"] = int(keep["retry_attempt"] or 0) + 1
        _collapse_retries(plan)
        _publish_pending_retries(plan, source_id)
        return
    attempt = _max_attempt(plan, source_id) + 1
    source_key = source_unit_id or source_id
    plan["occurrences"].append({
        "occurrence_id": occurrence_id_for(round_id, source_key, attempt),
        "source_card_id": source_id,
        "source_unit_id": source_unit_id,
        "retry_attempt": attempt,
        "rating": rating,
        "insert_target_index": _predicted_insert_index(plan, source_id),
        "status": OCCURRENCE_PENDING,
        "encounter_id": encounter_id,
        "entered_on": _cohort_of(plan, source_id),
        "available_at": next_available,
        "kind": kind,
    })
    _collapse_retries(plan)
    _publish_pending_retries(plan, source_id)


__all__ = [
    "_fail_source",
    "_occurrence_owns_score",
    "_publish_pending_retries",
    "_revive_occurrence",
]
