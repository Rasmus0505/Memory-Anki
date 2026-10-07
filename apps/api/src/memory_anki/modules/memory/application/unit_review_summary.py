"""Read summaries derived exclusively from permanent-mark review units."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_start_as_utc_naive, to_api_datetime
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from .unit_review_projection import (
    UnitDefinition,
    _active_unit_key,
    _states_in_topology_order,
    get_palace_unit_projection,
    resolve_unit_definitions,
    unit_payload,
)
from .unit_review_service import list_due_units


def _due_datetime(raw: str | None) -> str | None:
    if not raw:
        return None
    return to_api_datetime(local_calendar_day_start_as_utc_naive(date.fromisoformat(raw)))


def _palace_id_of(item: Any) -> int:
    """Accept Palace ORM rows, raw ids, or tree dicts with palace_id/id."""
    if isinstance(item, bool):
        raise TypeError(f"invalid palace id: {item!r}")
    if isinstance(item, int):
        return item
    if isinstance(item, Mapping):
        raw = item.get("id", item.get("palace_id"))
        if raw is not None:
            return int(raw)
        raise TypeError(f"palace mapping missing id/palace_id: {item!r}")
    raw = getattr(item, "id", None)
    if raw is not None:
        return int(raw)
    return int(item)


def get_palace_review_summary(
    session: Session,
    palace_id: int,
    **_: Any,
) -> dict[str, Any]:
    try:
        projection = get_palace_unit_projection(session, palace_id)
    except ValueError:
        return {
            "palace_id": palace_id,
            "units": [],
            "mark_required": True,
            "permanent_mark_count": 0,
            "unit_count": 0,
            "due_unit_count": 0,
            "has_due_review": False,
            "next_review_at": None,
            "next_review_date": None,
            "review_status": "marking_required",
        }
    units = list(projection["units"])
    due_units = [unit for unit in units if unit["due"]]
    next_at = _due_datetime(projection.get("next_review_date"))
    return {
        **projection,
        "unit_count": len(units),
        "due_unit_count": len(due_units),
        "has_due_review": bool(due_units),
        "next_review_at": next_at,
    }


def read_palace_due_signals(
    session: Session,
    palace_ids: Iterable[int],
) -> dict[int, dict[str, Any]]:
    """Stored due signals for catalog reads.

    Uses persisted ``ReviewUnitState`` rows only. It does not parse editor
    documents or reconcile, so a bookshelf GET stays readable while an editor
    save holds the runtime storage lock.
    """
    ordered_ids = list(dict.fromkeys(int(item) for item in palace_ids))
    if not ordered_ids:
        return {}
    # A catalog GET must not flush unrelated dirty state into the storage lock.
    with session.no_autoflush:
        rows = (
            session.query(ReviewUnitState.palace_id, ReviewUnitState.due_date)
            .filter(
                ReviewUnitState.active.is_(True),
                ReviewUnitState.palace_id.in_(ordered_ids),
            )
            .all()
        )
    today = date.today()
    has_due: dict[int, bool] = {}
    next_due: dict[int, date] = {}
    due_counts: dict[int, int] = {}
    for palace_id, due_date in rows:
        if due_date <= today:
            has_due[palace_id] = True
            due_counts[palace_id] = due_counts.get(palace_id, 0) + 1
        current = next_due.get(palace_id)
        if current is None or due_date < current:
            next_due[palace_id] = due_date
    result: dict[int, dict[str, Any]] = {}
    for palace_id in ordered_ids:
        next_day = next_due.get(palace_id)
        result[palace_id] = {
            "has_due_review": bool(has_due.get(palace_id)),
            "next_review_at": _due_datetime(next_day.isoformat()) if next_day else None,
            "due_unit_count": due_counts.get(palace_id, 0),
        }
    return result


def project_palace_review_summaries(
    session: Session,
    palaces: Iterable[Any],
    **_: Any,
) -> dict[int, dict[str, Any]]:
    """Batch projection of palace review summaries.

    Loads active ReviewUnitStates in one query and resolves definitions per
    palace. Lagging hashes are left for an explicit reconcile command; catalog
    and feed reads must not write.
    """
    palace_list = list(palaces)
    if not palace_list:
        return {}
    palace_ids = [_palace_id_of(item) for item in palace_list]
    # Preserve first-seen order while de-duplicating.
    ordered_ids: list[int] = list(dict.fromkeys(palace_ids))
    palace_map = {
        row.id: row
        for row in session.query(Palace).filter(Palace.id.in_(ordered_ids)).all()
    }
    states = (
        session.query(ReviewUnitState)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.palace_id.in_(ordered_ids),
        )
        .all()
    )
    state_by_palace: dict[int, list[ReviewUnitState]] = {}
    for row in states:
        state_by_palace.setdefault(row.palace_id, []).append(row)

    definitions_by_palace: dict[int, list[UnitDefinition]] = {}
    for pid, _palace in palace_map.items():
        try:
            _, defs = resolve_unit_definitions(session, pid)
            definitions_by_palace[pid] = defs
        except ValueError:
            definitions_by_palace[pid] = []

    result: dict[int, dict[str, Any]] = {}
    for pid in ordered_ids:
        palace = palace_map.get(pid)
        if palace is None:
            result[pid] = {
                "palace_id": pid,
                "title": "",
                "mark_required": True,
                "permanent_mark_count": 0,
                "unit_count": 0,
                "due_unit_count": 0,
                "next_review_date": None,
                "review_status": "marking_required",
                "units": [],
                "has_due_review": False,
                "next_review_at": None,
            }
            continue

        states_for_p = state_by_palace.get(pid, [])
        defs = definitions_by_palace.get(pid, [])
        result[pid] = _build_projection(states_for_p, defs, pid, palace)
    return result


def _build_projection(
    states: list[ReviewUnitState],
    definitions: list[UnitDefinition],
    palace_id: int,
    palace: Palace,
) -> dict[str, Any]:
    if not definitions:
        return {
            "palace_id": palace_id,
            "title": palace.title or "",
            "mark_required": True,
            "permanent_mark_count": 0,
            "unit_count": 0,
            "due_unit_count": 0,
            "next_review_date": None,
            "review_status": "marking_required",
            "units": [],
            "has_due_review": False,
            "next_review_at": None,
        }
    definition_by_key = {
        _active_unit_key(item.anchor_uid, item.unit_kind): item for item in definitions
    }
    states = _states_in_topology_order(states, definitions)
    due = [row for row in states if row.due_date <= date.today()]
    next_due = min((row.due_date for row in states), default=None)
    next_review_date = next_due.isoformat() if next_due else None
    return {
        "palace_id": palace_id,
        "title": palace.title or "",
        "mark_required": False,
        "permanent_mark_count": 0,
        "unit_count": len(states),
        "due_unit_count": len(due),
        "next_review_date": next_review_date,
        "review_status": "due" if due else "scheduled",
        "units": [
            unit_payload(
                row,
                definition_by_key.get(_active_unit_key(row.anchor_uid, row.unit_kind)),
            )
            for row in states
        ],
        "has_due_review": bool(due),
        "next_review_at": _due_datetime(next_review_date),
    }


def get_review_queue_summary(session: Session, **_: Any) -> dict[str, Any]:
    # Read-only summary (dashboard, review queue). Defer a lagging palace to the
    # background reconciler instead of rebuilding inside this request: the rebuild
    # is a write that would take the global storage lock and stall every other
    # caller behind a 15s timeout.
    items = list_due_units(session, allow_reconcile=False)
    return {
        "items": items,
        "count": len(items),
        "due_count": len(items),
        "reviews": items,
    }


def get_unit_review_weekly_stats(session: Session) -> dict[str, Any]:
    since = datetime.now() - timedelta(days=7)
    operations = (
        session.query(ReviewUnitRatingOperation)
        .filter(
            ReviewUnitRatingOperation.created_at >= since,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .all()
    )
    return {
        "review_count": sum(1 for item in operations if item.passed),
        "rating_count": len(operations),
        "review_duration_seconds": 0,
    }


__all__ = [
    "get_palace_review_summary",
    "get_review_queue_summary",
    "get_unit_review_weekly_stats",
    "project_palace_review_summaries",
    "read_palace_due_signals",
]
