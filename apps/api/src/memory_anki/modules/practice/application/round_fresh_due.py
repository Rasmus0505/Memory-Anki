"""Serve-time release of a previous visit's score on a due-again card.

The persisted plan stays fingerprint-pure. A due card with no effective rating
today is a new appearance: no encounter rating, no occurrence rating, and not
in the served completed set. Excluded and compressed cards stay hidden. A
rating whose local day is today stays, including 困难 which is still due.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_of, utc_now_naive
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitRatingOperation
from memory_anki.modules.memory.api import list_due_review_unit_ids
from memory_anki.modules.practice.domain.round_plan_values import _review_unit_id, _text


def beijing_today() -> date:
    return local_calendar_day_of(utc_now_naive())


def _card_unit_map(plan: dict[str, Any]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for item in plan.get("original_cards") or []:
        if not isinstance(item, dict):
            continue
        card_id = _text(item.get("card_id"))
        unit_id = _text(item.get("unit_id")) or _review_unit_id(card_id)
        if card_id and unit_id:
            mapping[card_id] = unit_id
    for item in plan.get("occurrences") or []:
        if not isinstance(item, dict):
            continue
        source_id = _text(item.get("source_card_id"))
        unit_id = _text(item.get("source_unit_id")) or mapping.get(source_id, "")
        if not unit_id:
            continue
        occ_id = _text(item.get("occurrence_id"))
        if occ_id:
            mapping[occ_id] = unit_id
        if source_id:
            mapping.setdefault(source_id, unit_id)
    for card_id in plan.get("encounters") or {}:
        key = _text(card_id)
        if key and key not in mapping:
            unit_id = _review_unit_id(key)
            if unit_id:
                mapping[key] = unit_id
    return mapping


def units_rated_on(session: Session, unit_ids: list[str], on: date) -> set[str]:
    ids = [item for item in unit_ids if item]
    if not ids:
        return set()
    found: set[str] = set()
    chunk = 400
    for start in range(0, len(ids), chunk):
        part = ids[start : start + chunk]
        rows = (
            session.query(
                ReviewUnitRatingOperation.unit_id,
                ReviewUnitRatingOperation.created_at,
            )
            .filter(
                ReviewUnitRatingOperation.unit_id.in_(part),
                ReviewUnitRatingOperation.undone_at.is_(None),
                ReviewUnitRatingOperation.replaced_at.is_(None),
            )
            .all()
        )
        for unit_id, created_at in rows:
            if created_at is None:
                continue
            if local_calendar_day_of(created_at) == on:
                found.add(str(unit_id))
    return found


def fresh_due_card_ids(
    session: Session,
    plan: dict[str, Any],
    *,
    today: date | None = None,
) -> list[str]:
    on = today or beijing_today()
    mapping = _card_unit_map(plan)
    if not mapping:
        return []
    held_out = {
        _text(item)
        for item in [*(plan.get("excluded_ids") or []), *(plan.get("compressed_ids") or [])]
        if _text(item)
    }
    due = list_due_review_unit_ids(session, list(set(mapping.values())), today=on)
    if not due:
        return []
    rated = units_rated_on(session, list(due), on)
    fresh_units = due - rated
    if not fresh_units:
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for card_id, unit_id in mapping.items():
        if unit_id not in fresh_units or card_id in held_out or card_id in seen:
            continue
        seen.add(card_id)
        ids.append(card_id)
    return ids


def project_served_plan(
    session: Session,
    plan: dict[str, Any],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Return a response plan. Does not mutate the persisted plan."""
    fresh = fresh_due_card_ids(session, plan, today=today)
    served = dict(plan)
    if not fresh:
        # Read-time publishing may reopen/insert occurrences and drop their
        # encounter entries; the response must not alias the persisted rows.
        served["occurrences"] = [
            dict(occ) if isinstance(occ, dict) else occ
            for occ in plan.get("occurrences") or []
        ]
        served["encounters"] = {
            key: dict(value) if isinstance(value, dict) else value
            for key, value in (plan.get("encounters") or {}).items()
        }
        served.pop("fresh_due_ids", None)
        return served
    fresh_set = set(fresh)
    encounters: dict[str, Any] = {}
    for card_id, enc in (plan.get("encounters") or {}).items():
        if _text(card_id) in fresh_set:
            continue
        encounters[card_id] = enc
    occurrences = []
    for occ in plan.get("occurrences") or []:
        if not isinstance(occ, dict):
            occurrences.append(occ)
            continue
        occ_id = _text(occ.get("occurrence_id"))
        source_id = _text(occ.get("source_card_id"))
        if occ_id in fresh_set or source_id in fresh_set:
            cleaned = dict(occ)
            cleaned["rating"] = None
            occurrences.append(cleaned)
        else:
            # The response is a projection: read-time publishing mutates these
            # rows (status / attempt / wait), so they must not alias the
            # persisted plan's dicts.
            occurrences.append(dict(occ))
    served["encounters"] = encounters
    served["occurrences"] = occurrences
    served["completed_ids"] = [
        item for item in (plan.get("completed_ids") or []) if _text(item) not in fresh_set
    ]
    served["fresh_due_ids"] = fresh
    return served
