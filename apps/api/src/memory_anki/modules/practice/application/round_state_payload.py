"""Serialization and read-only payload projection for persisted round state."""

from __future__ import annotations

import json
from typing import Any, overload

from memory_anki.core.time import (
    to_api_datetime,
    utc_now_naive,
)
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.practice.application.round_fresh_due import project_served_plan
from memory_anki.modules.practice.domain.round_plan import normalize_plan
from memory_anki.modules.practice.domain.round_plan_intraday import (
    plan_waiting,
    publish_ready_retries,
)
from memory_anki.modules.practice.domain.workspace import normalize_workspace

_SUMMARY_CHUNK = 400


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_dump(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True)


def _json_load_object(raw: str | None) -> dict[str, Any]:
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _plan_of(row: FreestyleRoundState) -> dict[str, Any]:
    return normalize_plan(_json_load_object(row.plan_json))


def _fingerprint(row: FreestyleRoundState, plan: dict[str, Any] | None = None) -> str:
    return _json_dump(
        {
            "status": row.status,
            "config": _json_load_object(row.config_json),
            "plan": plan if plan is not None else _plan_of(row),
            "current_card_id": row.current_card_id,
            "scope_key": row.scope_key,
        }
    )


def _payload(
    row: FreestyleRoundState,
    *,
    conflict: bool = False,
    duplicate: bool = False,
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = _json_load_object(row.config_json)
    resolved_plan = normalize_plan(plan if plan is not None else _json_load_object(row.plan_json))
    version = int(row.version or 1)
    current = resolved_plan.get("current_card_id")
    if current is None:
        current = row.current_card_id
    return {
        "round_id": row.round_id,
        "workspace": normalize_workspace(getattr(row, "workspace", None)),
        "scope_key": row.scope_key,
        "status": row.status,
        "version": version,
        "plan_version": version,
        "config": _json_object(config),
        "plan": resolved_plan,
        "current_card_id": current,
        "last_operation_id": row.last_operation_id,
        "updated_at": to_api_datetime(row.updated_at) if row.updated_at else None,
        "conflict": conflict,
        "duplicate": duplicate,
    }


def _unfinished_summary(session: Any, plan: dict[str, Any]) -> dict[str, Any]:
    excluded = set(plan.get("excluded_ids") or [])
    completed = set(plan.get("completed_ids") or [])
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in plan.get("original_cards") or []:
        if not isinstance(item, dict):
            continue
        card_id = item.get("card_id")
        if not card_id or card_id in seen or card_id in excluded or card_id in completed:
            continue
        seen.add(card_id)
        cards.append(item)
    unit_ids = sorted({str(c["unit_id"]) for c in cards if c.get("unit_id")})
    passed: set[str] = set()
    for start in range(0, len(unit_ids), _SUMMARY_CHUNK):
        part = unit_ids[start : start + _SUMMARY_CHUNK]
        for uid, has_passed in session.query(ReviewUnitState.id, ReviewUnitState.has_passed).filter(
            ReviewUnitState.id.in_(part)
        ):
            if has_passed:
                passed.add(uid)
    order: list[dict[str, Any]] = []
    for card in cards:
        unit_id = str(card["unit_id"]) if card.get("unit_id") else None
        order.append(
            {
                "card_id": card["card_id"],
                "unit_id": unit_id,
                "palace_id": card.get("palace_id"),
                "kind": "review" if unit_id in passed else "new",
            }
        )
    new_count = sum(1 for item in order if item["kind"] == "new")
    return {
        "new_count": new_count,
        "review_count": len(order) - new_count,
        "skipped_count": len(excluded),
        "order": order,
    }


@overload
def _serve(session: Any, row: FreestyleRoundState, **kwargs: Any) -> dict[str, Any]: ...


@overload
def _serve(session: Any, row: None, **kwargs: Any) -> None: ...


def _serve(session: Any, row: FreestyleRoundState | None, **kwargs: Any) -> dict[str, Any] | None:
    """Response wrapper. Strips a previous visit's score without touching the row."""
    if row is None:
        return None
    payload = _payload(row, **kwargs)
    plan = payload.get("plan")
    if not isinstance(plan, dict):
        return payload
    served = dict(payload)
    served_plan = project_served_plan(session, plan)
    # Same-day steps/retries appear on the rail only once their wait has passed.
    # This is a read-time projection; the persisted plan keeps them pending.
    served_plan = publish_ready_retries(served_plan, now=utc_now_naive())
    served["plan"] = served_plan
    served["waiting"] = plan_waiting(served_plan)
    served["summary"] = _unfinished_summary(session, served_plan)
    return served


