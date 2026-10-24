"""Read-only freestyle overview: start-page counts, yesterday's recap, next reviews."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from memory_anki.core.time import (
    local_calendar_day_bounds_as_utc_naive,
    local_day,
    resolve_local_timezone,
)
from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, palace_subject_table
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.exam.api import milestone_upcoming
from memory_anki.modules.memory.api import INTERVAL_DAYS, resolve_unit_definitions
from memory_anki.modules.practice.application.round_state_service import get_round

WEAK_AGAIN_RATIO = 0.5
WEAK_LIMIT = 5
UNSORTED_SUBJECT = "未分科"
RATING_AGAIN = 1
_CHUNK = 400


def _zone(tz_name: str | None) -> tzinfo:
    if not tz_name:
        return resolve_local_timezone()
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"invalid timezone: {tz_name}") from exc


def _chunks(items: list[str]):
    for start in range(0, len(items), _CHUNK):
        yield items[start : start + _CHUNK]


def _states_by_id(session: Session, unit_ids: set[str]) -> dict[str, ReviewUnitState]:
    found: dict[str, ReviewUnitState] = {}
    for part in _chunks(sorted(unit_ids)):
        for row in session.query(ReviewUnitState).filter(ReviewUnitState.id.in_(part)).all():
            found[row.id] = row
    return found


def _palace_titles(session: Session, palace_ids: set[int]) -> dict[int, str]:
    if not palace_ids:
        return {}
    rows = (
        session.query(Palace.id, Palace.title)
        .filter(Palace.id.in_(sorted(palace_ids)))
        .all()
    )
    return {int(pid): title or "" for pid, title in rows}


def _unit_titles(session: Session, palace_ids: set[int]) -> dict[tuple[int, str, str], str]:
    titles: dict[tuple[int, str, str], str] = {}
    for pid in sorted(palace_ids):
        try:
            _, definitions = resolve_unit_definitions(session, pid)
        except ValueError:
            continue
        for item in definitions:
            titles[(pid, item.anchor_uid, item.unit_kind)] = item.title or ""
    return titles


def _subjects_for_palaces(
    session: Session,
    palace_ids: set[int],
) -> dict[int, list[tuple[int, str, int]]]:
    if not palace_ids:
        return {}
    stmt = (
        select(
            palace_subject_table.c.palace_id,
            Subject.id,
            Subject.name,
            Subject.sort_order,
        )
        .select_from(palace_subject_table)
        .join(Subject, Subject.id == palace_subject_table.c.subject_id)
        .where(palace_subject_table.c.palace_id.in_(sorted(palace_ids)))
    )
    owners: dict[int, list[tuple[int, str, int]]] = defaultdict(list)
    for pid, sid, name, order in session.execute(stmt).all():
        owners[int(pid)].append((int(sid), name, int(order or 0)))
    for items in owners.values():
        # The first entry is the palace's primary subject (lowest sort order).
        items.sort(key=lambda item: (item[2], item[0]))
    return owners


def _round_block(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("plan") or {}
    excluded = set(plan.get("excluded_ids") or [])
    completed = set(plan.get("completed_ids") or [])
    cards = [
        item
        for item in plan.get("original_cards") or []
        if isinstance(item, dict) and item.get("card_id") and item["card_id"] not in excluded
    ]
    palace_ids = {int(c["palace_id"]) for c in cards if c.get("palace_id") is not None}
    unit_ids = {str(c["unit_id"]) for c in cards if c.get("unit_id")}
    states = _states_by_id(session, unit_ids)
    new_units = {uid for uid in unit_ids if uid not in states or not states[uid].has_passed}
    owners = _subjects_for_palaces(session, palace_ids)

    buckets: dict[int | None, dict[str, Any]] = {}
    subject_order: dict[int, int] = {}
    done = 0
    remaining_palace_ids: set[int] = set()
    remaining_unit_ids: set[str] = set()
    for card in cards:
        is_done = card["card_id"] in completed
        done += int(is_done)
        pid = card.get("palace_id")
        if not is_done:
            if pid is not None:
                remaining_palace_ids.add(int(pid))
            if card.get("unit_id"):
                remaining_unit_ids.add(str(card["unit_id"]))
        card_owners: Sequence[tuple[int | None, str, int]] = (
            owners.get(int(pid), []) if pid is not None else []
        )
        # Count each card under its primary subject only, so subject totals never double count.
        subject_id, name, order = card_owners[0] if card_owners else (None, UNSORTED_SUBJECT, 0)
        if subject_id is not None:
            subject_order[subject_id] = order
        bucket = buckets.setdefault(
            subject_id,
            {"subject_id": subject_id, "name": name, "done": 0, "total": 0},
        )
        bucket["total"] += 1
        bucket["done"] += int(is_done)

    by_subject = sorted(
        buckets.values(),
        key=lambda b: (b["subject_id"] is None, subject_order.get(b["subject_id"], 0), b["name"]),
    )
    return {
        "round_id": payload.get("round_id"),
        "version": payload.get("version"),
        "counts": {
            "palaces": len(palace_ids),
            "units": len(unit_ids),
            "new": len(new_units),
            "review": len(unit_ids) - len(new_units),
            "done": done,
            "remaining": len(cards) - done,
            "remaining_palaces": len(remaining_palace_ids),
            "remaining_units": len(remaining_unit_ids),
        },
        "by_subject": by_subject,
    }


def _unit_palace_counts(session: Session, *conditions: Any) -> dict[str, int]:
    """Distinct live units and the palaces holding them, for units matching the conditions."""
    row = (
        session.query(
            func.count(ReviewUnitState.id),
            func.count(distinct(ReviewUnitState.palace_id)),
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
            *conditions,
        )
        .one()
    )
    return {"units": int(row[0] or 0), "palaces": int(row[1] or 0)}


def _today_block(session: Session, day: date) -> dict[str, Any]:
    due = _unit_palace_counts(session, ReviewUnitState.due_date <= day)
    overdue = _unit_palace_counts(session, ReviewUnitState.due_date < day)
    new = _unit_palace_counts(session, ReviewUnitState.has_passed.is_(False))
    return {
        "due_count": due["units"],
        "due_palace_count": due["palaces"],
        "overdue_count": overdue["units"],
        "new_unit_count": new["units"],
        "new_palace_count": new["palaces"],
    }



def _yesterday_block(session: Session, day: date, zone: tzinfo) -> dict[str, Any]:
    yesterday = day - timedelta(days=1)
    start = local_calendar_day_bounds_as_utc_naive(yesterday, zone)[0]
    end = local_calendar_day_bounds_as_utc_naive(day, zone)[0]
    rows = (
        session.query(ReviewUnitRatingOperation.unit_id, ReviewUnitRatingOperation.rating)
        .filter(
            ReviewUnitRatingOperation.created_at >= start,
            ReviewUnitRatingOperation.created_at < end,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .all()
    )
    totals: dict[str, int] = defaultdict(int)
    agains: dict[str, int] = defaultdict(int)
    for unit_id, rating in rows:
        totals[unit_id] += 1
        if rating == RATING_AGAIN:
            agains[unit_id] += 1
    ratios = {uid: agains[uid] / totals[uid] for uid in totals}
    weak_ids = sorted(
        (uid for uid, ratio in ratios.items() if ratio >= WEAK_AGAIN_RATIO),
        key=lambda uid: (-ratios[uid], uid),
    )[:WEAK_LIMIT]
    learned_states = _states_by_id(session, set(totals))
    learned_palace_ids = {state.palace_id for state in learned_states.values()}
    states = _states_by_id(session, set(weak_ids))
    palace_ids = {state.palace_id for state in states.values()}
    titles = _unit_titles(session, palace_ids)
    palace_titles = _palace_titles(session, palace_ids)
    weak_units = []
    for uid in weak_ids:
        state = states.get(uid)
        if state is None:
            continue
        weak_units.append(
            {
                "unit_id": uid,
                "name": titles.get((state.palace_id, state.anchor_uid, state.unit_kind), ""),
                "palace_name": palace_titles.get(state.palace_id, ""),
                "again_ratio": round(ratios[uid], 2),
            }
        )
    return {
        "date": yesterday.isoformat(),
        "learned_units": len(totals),
        "learned_palace_count": len(learned_palace_ids),
        "weak_units": weak_units,
    }


def _next_reviews_block(session: Session, day: date) -> list[dict[str, Any]]:
    rows = (
        session.query(ReviewUnitState)
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date > day,
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .order_by(ReviewUnitState.due_date, ReviewUnitState.id)
        .all()
    )
    palace_ids = {row.palace_id for row in rows}
    titles = _unit_titles(session, palace_ids)
    palace_titles = _palace_titles(session, palace_ids)
    return [
        {
            "unit_id": row.id,
            "name": titles.get((row.palace_id, row.anchor_uid, row.unit_kind), ""),
            "palace_name": palace_titles.get(row.palace_id, ""),
            "due_date": row.due_date.isoformat(),
            "interval_days": INTERVAL_DAYS[row.stage_index],
        }
        for row in rows
    ]


def build_freestyle_overview(
    session: Session,
    *,
    day_text: str | None = None,
    tz_name: str | None = None,
    round_id: str | None = None,
) -> dict[str, Any]:
    zone = _zone(tz_name)
    day = date.fromisoformat(day_text) if day_text else local_day(tz_name)
    payload = get_round(session, round_id) if round_id else None
    return {
        "round": _round_block(session, payload) if payload is not None else None,
        "milestones": milestone_upcoming(session, today=day),
        "today": _today_block(session, day),
        "yesterday": _yesterday_block(session, day, zone),
        "next_reviews": _next_reviews_block(session, day),
    }
