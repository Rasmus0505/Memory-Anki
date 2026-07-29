"""Palace ladder progress read model for the mindmap toolbar strip."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_start_as_utc_naive, to_api_datetime
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from .unit_review_projection import get_palace_unit_projection
from .unit_review_service import _encounter_billable_seconds
from .unit_scheduler import INTERVAL_DAYS, clamp_stage

LadderRange = Literal["today", "last3days", "week", "all"]
VALID_RANGES = frozenset({"today", "last3days", "week", "all"})


def _empty_stage_bucket(stage_index: int) -> dict[str, Any]:
    return {
        "stage_index": stage_index,
        "interval_days": INTERVAL_DAYS[stage_index],
        "pass_count": 0,
        "last_at": None,
        "seconds": 0,
    }


def _empty_rating_share() -> dict[str, int]:
    return {"forgot": 0, "hard": 0, "remember": 0, "easy": 0}


def _empty_range_stats(range_key: str) -> dict[str, Any]:
    return {
        "range": range_key,
        "per_stage": [_empty_stage_bucket(i) for i in range(len(INTERVAL_DAYS))],
        "total_reviews": 0,
        "total_seconds": 0,
        "rating_share": _empty_rating_share(),
    }


def resolve_range_start(range_key: str, *, today: date | None = None) -> datetime | None:
    """Inclusive lower bound in UTC-naive storage time, or None for all-time."""
    key = str(range_key or "all").strip().lower()
    if key not in VALID_RANGES:
        raise ValueError("range must be today, last3days, week, or all")
    if key == "all":
        return None
    day = today or date.today()
    if key == "today":
        return local_calendar_day_start_as_utc_naive(day)
    if key == "last3days":
        return local_calendar_day_start_as_utc_naive(day - timedelta(days=2))
    # week = local Monday 00:00 through now
    monday = day - timedelta(days=day.weekday())
    return local_calendar_day_start_as_utc_naive(monday)


def _rating_key(rating: int) -> str | None:
    return {1: "forgot", 2: "hard", 3: "remember", 4: "easy"}.get(int(rating))


def _stage_from_state_snapshot_json(raw: str | None) -> int | None:
    try:
        payload = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return None
    state = payload.get("state") if isinstance(payload, dict) else None
    if not isinstance(state, dict):
        return None
    try:
        return clamp_stage(int(state.get("stage_index", 0)))
    except (TypeError, ValueError):
        return None


def _accumulate_ops(
    ops: list[ReviewUnitRatingOperation],
) -> tuple[list[dict[str, Any]], dict[str, int], int]:
    per_stage = [_empty_stage_bucket(i) for i in range(len(INTERVAL_DAYS))]
    share = _empty_rating_share()
    total_reviews = 0
    for op in ops:
        key = _rating_key(op.rating)
        if key is not None:
            share[key] += 1
        total_reviews += 1
        if not op.passed:
            continue
        # A pass belongs to the stage that was actually reviewed, not the
        # destination stage after scheduling advances (which may jump twice on
        # an "easy" rating). This matches encounter duration attribution below.
        stage = _stage_from_state_snapshot_json(op.before_state_json)
        if stage is None:
            continue
        bucket = per_stage[stage]
        bucket["pass_count"] += 1
        stamp = to_api_datetime(op.created_at)
        if stamp and (bucket["last_at"] is None or stamp > bucket["last_at"]):
            bucket["last_at"] = stamp
    return per_stage, share, total_reviews


def _accumulate_encounter_seconds(
    encounters: list[ReviewUnitEncounter],
    per_stage: list[dict[str, Any]],
) -> int:
    total = 0
    for encounter in encounters:
        seconds = _encounter_billable_seconds(encounter)
        if seconds <= 0:
            continue
        total += seconds
        stage = _stage_from_state_snapshot_json(encounter.baseline_state_json)
        if stage is None:
            continue
        per_stage[stage]["seconds"] += seconds
    return total


def _build_range_stats(
    session: Session,
    *,
    palace_id: int,
    unit_id: str | None,
    range_key: str,
    since: datetime | None,
) -> dict[str, Any]:
    op_query = session.query(ReviewUnitRatingOperation).filter(
        ReviewUnitRatingOperation.palace_id == palace_id,
        ReviewUnitRatingOperation.undone_at.is_(None),
        ReviewUnitRatingOperation.replaced_at.is_(None),
    )
    if unit_id:
        op_query = op_query.filter(ReviewUnitRatingOperation.unit_id == unit_id)
    if since is not None:
        op_query = op_query.filter(ReviewUnitRatingOperation.created_at >= since)
    ops = op_query.order_by(ReviewUnitRatingOperation.created_at.asc()).all()
    per_stage, share, total_reviews = _accumulate_ops(ops)

    encounter_query = (
        session.query(ReviewUnitEncounter)
        .join(ReviewUnitState, ReviewUnitState.id == ReviewUnitEncounter.unit_id)
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitEncounter.status == "closed",
            ReviewUnitEncounter.selected_rating.isnot(None),
        )
    )
    if unit_id:
        encounter_query = encounter_query.filter(ReviewUnitEncounter.unit_id == unit_id)
    if since is not None:
        encounter_query = encounter_query.filter(ReviewUnitEncounter.closed_at >= since)
    encounters = encounter_query.all()
    total_seconds = _accumulate_encounter_seconds(encounters, per_stage)

    return {
        "range": range_key,
        "per_stage": per_stage,
        "total_reviews": total_reviews,
        "total_seconds": total_seconds,
        "rating_share": share,
    }


def get_palace_ladder_progress(
    session: Session,
    palace_id: int,
    *,
    unit_id: str | None = None,
    range_key: str = "all",
    today: date | None = None,
) -> dict[str, Any]:
    """Current unit ladder + palace histogram + range-scoped review stats."""
    key = str(range_key or "all").strip().lower() or "all"
    since = resolve_range_start(key, today=today)

    try:
        projection = get_palace_unit_projection(session, palace_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    units = list(projection.get("units") or [])
    histogram = [0 for _ in INTERVAL_DAYS]
    weakest_stage: int | None = None
    for unit in units:
        stage = clamp_stage(int(unit.get("stage_index") or 0))
        histogram[stage] += 1
        if weakest_stage is None or stage < weakest_stage:
            weakest_stage = stage

    current = None
    scope = "palace"
    if unit_id:
        match = next((item for item in units if str(item.get("id")) == str(unit_id)), None)
        if match is not None:
            current = {
                "unit_id": match["id"],
                "title": match.get("title") or "",
                "stage_index": int(match["stage_index"]),
                "interval_days": int(match["interval_days"]),
                "due_date": match.get("due_date"),
                "due": bool(match.get("due")),
                "has_passed": bool(match.get("has_passed")),
            }
            scope = "unit"

    if current is None and units:
        # Fallback: weakest active unit for whole-palace display.
        weakest = min(units, key=lambda item: (int(item.get("stage_index") or 0), str(item.get("id"))))
        current = {
            "unit_id": weakest["id"],
            "title": weakest.get("title") or "",
            "stage_index": int(weakest["stage_index"]),
            "interval_days": int(weakest["interval_days"]),
            "due_date": weakest.get("due_date"),
            "due": bool(weakest.get("due")),
            "has_passed": bool(weakest.get("has_passed")),
        }
        scope = "palace"

    unit_stats_id = current["unit_id"] if current is not None else None
    unit_range = (
        _build_range_stats(
            session,
            palace_id=palace_id,
            unit_id=unit_stats_id,
            range_key=key,
            since=since,
        )
        if unit_stats_id
        else _empty_range_stats(key)
    )
    palace_range = _build_range_stats(
        session,
        palace_id=palace_id,
        unit_id=None,
        range_key=key,
        since=since,
    )

    return {
        "palace_id": palace_id,
        "title": projection.get("title") or "",
        "ladder": list(INTERVAL_DAYS),
        "scope": scope,
        "current": current,
        "palace": {
            "unit_count": int(projection.get("unit_count") or len(units)),
            "due_count": int(projection.get("due_unit_count") or 0),
            "weakest_stage_index": weakest_stage,
            "stage_histogram": histogram,
            "next_review_date": projection.get("next_review_date"),
            "review_status": projection.get("review_status"),
            "mark_required": bool(projection.get("mark_required")),
        },
        "unit_range_stats": unit_range,
        "palace_range_stats": palace_range,
    }


__all__ = [
    "VALID_RANGES",
    "get_palace_ladder_progress",
    "resolve_range_start",
]
