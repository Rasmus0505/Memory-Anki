"""Trusted due-unit reads for queue build.

Queue build must not parse editor_doc or reconcile. Opening a unit reconciles
that palace; this read returns the stored active rows.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_bounds_as_utc_naive, utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from .unit_review_projection import json_load_list

__all__ = [
    "list_palace_ids_without_units",
    "count_active_units_by_palace",
    "count_units_due_on",
    "list_round_unit_ratings",
    "list_trusted_due_units_for_queue",
    "list_units_rated_on",
    "list_unit_node_members",
    "summarize_waiting_units",
]


def list_round_unit_ratings(
    session: Session,
    round_id: str,
) -> dict[str, int]:
    """Authoritative this-round 1–4 rating per ``unit_id``.

    Reads ``review_unit_encounters`` rather than the round plan's cached
    ``encounters`` map. The cached copy is *not* the source of truth: on a real
    round it held 29 entries where only 3 carried a ``rating`` field, while the
    encounter table held all 29 ratings. Trusting the cache would print
    「本轮尚未复习」 for knowledge points the learner had just scored.

    Lowest wins when a unit was rated more than once this round: the badge
    should point at the weakest evidence, not the most recent comfort. A unit
    the learner completed without picking a score has no rating here and must
    not be given one — completion alone never invents 记得.
    """
    rid = str(round_id or "").strip()
    if not rid:
        return {}
    rows = (
        session.query(
            ReviewUnitEncounter.unit_id,
            ReviewUnitEncounter.selected_rating,
        )
        .filter(
            ReviewUnitEncounter.round_id == rid,
            ReviewUnitEncounter.selected_rating.isnot(None),
        )
        .all()
    )
    ratings: dict[str, int] = {}
    for row in rows:
        unit_id = str(row.unit_id or "").strip()
        rating = int(row.selected_rating or 0)
        if not unit_id or rating not in {1, 2, 3, 4}:
            continue
        existing = ratings.get(unit_id)
        ratings[unit_id] = rating if existing is None else min(existing, rating)
    return ratings


def list_unit_node_members(
    session: Session,
    unit_ids: list[str],
) -> dict[str, list[str]]:
    """Node members per review unit, for callers resolving bound knowledge points.

    Read-only and storage-shaped on purpose: the 做题 badge needs to answer
    "which round unit owns this question's bound node", and that must not require
    parsing every palace's ``editor_doc``. Deleted/archived palaces are excluded
    so a question cannot resolve through a palace the learner removed.
    """
    wanted = [str(item).strip() for item in unit_ids if str(item).strip()]
    if not wanted:
        return {}
    rows = (
        session.query(ReviewUnitState.id, ReviewUnitState.node_uids_json)
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.id.in_(wanted),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .all()
    )
    result: dict[str, list[str]] = {}
    for row in rows:
        members = [uid for uid in json_load_list(row.node_uids_json) if uid]
        if members:
            result[str(row.id)] = members
    return result


def list_palace_ids_without_units(
    session: Session,
    palace_ids: list[int] | None = None,
) -> list[int]:
    """Live palaces that have never produced a ``ReviewUnitState`` row.

    These are the only palaces the queue cannot see without a reconcile: any
    palace with rows is already readable, and a palace whose topology changed
    is refreshed when it is opened.
    """
    if palace_ids is not None and not palace_ids:
        return []
    has_units = (
        session.query(ReviewUnitState.id)
        .filter(ReviewUnitState.palace_id == Palace.id)
        .exists()
    )
    query = session.query(Palace.id).filter(
        Palace.deleted_at.is_(None),
        Palace.archived.is_(False),
        ~has_units,
    )
    if palace_ids is not None:
        query = query.filter(Palace.id.in_(list(palace_ids)))
    return [int(row.id) for row in query.order_by(Palace.id.asc()).all()]


def list_trusted_due_units_for_queue(
    session: Session,
    today: date,
    palace_ids: list[int] | None = None,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Active due units for queue build, without parsing editor_doc.

    ``palace_ids is None`` means every active palace. An empty list means none.
    A unit whose intra-day step has not arrived yet is still due today, but it is
    not servable: the queue excludes it until ``intraday_due_at`` passes, so a
    short session cannot re-serve a failed card immediately.
    """
    if palace_ids is not None and not palace_ids:
        return []
    moment = now or utc_now_naive()
    query = (
        session.query(
            ReviewUnitState.id,
            ReviewUnitState.palace_id,
            ReviewUnitState.anchor_uid,
            ReviewUnitState.unit_kind,
            ReviewUnitState.node_uids_json,
            ReviewUnitState.revision,
            ReviewUnitState.has_passed,
            ReviewUnitState.due_date,
            ReviewUnitState.last_passed_at,
            ReviewUnitState.topology_order,
            Palace.group_sort_order,
            Palace.title,
            Palace.manual_title,
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= today,
            or_(
                ReviewUnitState.intraday_due_at.is_(None),
                ReviewUnitState.intraday_due_at <= moment,
            ),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
    )
    if palace_ids is not None:
        query = query.filter(ReviewUnitState.palace_id.in_(list(palace_ids)))
    rows = query.order_by(
        Palace.group_sort_order.asc(),
        Palace.id.asc(),
        ReviewUnitState.due_date.asc(),
        ReviewUnitState.topology_order.asc(),
        ReviewUnitState.id.asc(),
    ).all()
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(_unit_row_payload(row))
    return result


def _unit_row_payload(row: Any) -> dict[str, Any]:
    manual = str(getattr(row, "manual_title", "") or "").strip()
    title = manual or str(getattr(row, "title", "") or "")
    anchor = str(row.anchor_uid or "")
    node_uids = [uid for uid in json_load_list(row.node_uids_json) if uid]
    if not node_uids and anchor:
        node_uids = [anchor]
    return {
        "id": str(row.id),
        "palace_id": int(row.palace_id),
        "anchor_uid": anchor,
        "unit_kind": str(row.unit_kind or ""),
        "node_uids": node_uids,
        "revision": int(row.revision or 1),
        "has_passed": bool(row.has_passed),
        "due_date": row.due_date,
        "last_passed_at": row.last_passed_at,
        "topology_order": int(row.topology_order or 0),
        "title": title,
        "group_sort_order": int(getattr(row, "group_sort_order", 0) or 0),
    }


def list_units_rated_on(
    session: Session,
    day: date,
    palace_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Active units with a live rating operation on one study day.

    This is the candidate source for 睡前复习: every unit the learner already
    rated today, across rounds and workspaces. ``undone_at`` / ``replaced_at``
    rows are amendments and corrections, so they are not evidence of study.
    ``palace_ids is None`` means every live palace; an empty list means none.
    """
    if palace_ids is not None and not palace_ids:
        return []
    start, end = local_calendar_day_bounds_as_utc_naive(day)
    rated_units = (
        session.query(ReviewUnitRatingOperation.unit_id)
        .filter(
            ReviewUnitRatingOperation.created_at >= start,
            ReviewUnitRatingOperation.created_at < end,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .distinct()
        .all()
    )
    unit_ids = sorted({str(row.unit_id) for row in rated_units if str(row.unit_id or "")})
    if not unit_ids:
        return []
    query = (
        session.query(
            ReviewUnitState.id,
            ReviewUnitState.palace_id,
            ReviewUnitState.anchor_uid,
            ReviewUnitState.unit_kind,
            ReviewUnitState.node_uids_json,
            ReviewUnitState.revision,
            ReviewUnitState.has_passed,
            ReviewUnitState.due_date,
            ReviewUnitState.last_passed_at,
            ReviewUnitState.topology_order,
            Palace.group_sort_order,
            Palace.title,
            Palace.manual_title,
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.id.in_(unit_ids),
            ReviewUnitState.active.is_(True),
            ReviewUnitState.permanently_removed.is_(False),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
    )
    if palace_ids is not None:
        query = query.filter(ReviewUnitState.palace_id.in_(list(palace_ids)))
    rows = query.order_by(
        Palace.group_sort_order.asc(),
        Palace.id.asc(),
        ReviewUnitState.topology_order.asc(),
        ReviewUnitState.id.asc(),
    ).all()
    return [_unit_row_payload(row) for row in rows]


def count_active_units_by_palace(
    session: Session,
    palace_ids: list[int],
) -> dict[int, int]:
    """Active review-unit totals per palace, the denominator for round progress."""
    ids = [int(pid) for pid in palace_ids if int(pid) > 0]
    if not ids:
        return {}
    rows = (
        session.query(ReviewUnitState.palace_id, func.count(ReviewUnitState.id))
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.palace_id.in_(ids),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .group_by(ReviewUnitState.palace_id)
        .all()
    )
    return {int(palace_id): int(count or 0) for palace_id, count in rows}


def count_units_due_on(session: Session, day: date) -> int:
    total = (
        session.query(func.count(ReviewUnitState.id))
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date == day,
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .scalar()
    )
    return int(total or 0)


def list_palace_unit_pass_states(session: Session, palace_id: int) -> list[dict[str, Any]]:
    """Active 复习单元 of one palace with the node members each one covers and whether it has ever passed.

    Read-only. ``passed`` means the unit was rated 3 or 4 at least once, which is the 已学 definition.
    The mind-map uses this to colour a node card 复习 only when every unit under it has passed.
    """
    rows = (
        session.query(ReviewUnitState.id, ReviewUnitState.node_uids_json, ReviewUnitState.has_passed)
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitState.active.is_(True),
        )
        .all()
    )
    return [
        {
            "unit_id": str(row.id),
            "node_uids": [uid for uid in json_load_list(row.node_uids_json) if uid],
            "passed": bool(row.has_passed),
        }
        for row in rows
    ]


def summarize_waiting_units(
    session: Session,
    today: date,
    palace_ids: list[int] | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Units that are due today but booked for a later instant (same-day steps).

    The queue omits them; the round shows "N 张稍后" and refreshes at
    ``next_ready_at`` instead of pretending the day is done.
    """
    from memory_anki.core.time import to_api_datetime

    if palace_ids is not None and not palace_ids:
        return {"count": 0, "next_ready_at": None}
    moment = now or utc_now_naive()
    query = (
        session.query(
            func.count(ReviewUnitState.id),
            func.min(ReviewUnitState.intraday_due_at),
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= today,
            ReviewUnitState.intraday_due_at.is_not(None),
            ReviewUnitState.intraday_due_at > moment,
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
    )
    if palace_ids is not None:
        query = query.filter(ReviewUnitState.palace_id.in_(list(palace_ids)))
    count, next_at = query.one()
    return {
        "count": int(count or 0),
        "next_ready_at": to_api_datetime(next_at) if next_at is not None else None,
    }
