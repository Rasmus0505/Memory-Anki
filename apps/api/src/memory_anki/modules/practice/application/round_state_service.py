"""Persistent, optimistic freestyle round plan facade."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.memory.api import rate_palace_due_units, rate_review_unit
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    complete_card,
    exclude_card,
    leave_card,
    normalize_plan,
    plan_from_cards,
    rebind_plan_cards,
    restore_card,
    set_cursor,
    set_encounter,
    skip_card,
)

_ACTIONS = {
    "set_cursor",
    "leave_card",
    "skip",
    "complete",
    "exclude",
    "restore",
    "bind_cards",
    "set_encounter",
}


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


def _text(value: Any) -> str:
    return str(value or "").strip()


def _require_operation_id(operation_id: str | None) -> str:
    op_id = _text(operation_id)
    if not op_id:
        raise ValueError("operation_id is required")
    return op_id


def _plan_of(row: FreestyleRoundState) -> dict[str, Any]:
    return normalize_plan(_json_load_object(row.plan_json))


def _fingerprint(row: FreestyleRoundState, plan: dict[str, Any] | None = None) -> str:
    return _json_dump(
        {
            "status": row.status,
            "config": _json_load_object(row.config_json),
            "plan": plan if plan is not None else _plan_of(row),
            "current_card_id": row.current_card_id,
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


def _row_by_id(session: Session, round_id: str) -> FreestyleRoundState | None:
    rid = _text(round_id)
    if not rid:
        return None
    return session.get(FreestyleRoundState, rid)


def _active_row(session: Session, scope_key: str) -> FreestyleRoundState | None:
    key = _text(scope_key)[:256]
    if not key:
        return None
    return (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.scope_key == key,
            FreestyleRoundState.status == "active",
        )
        .order_by(FreestyleRoundState.updated_at.desc())
        .first()
    )


def _apply_plan(
    row: FreestyleRoundState,
    plan: dict[str, Any],
    *,
    operation_id: str,
    config: dict[str, Any] | None = None,
    status: str | None = None,
) -> bool:
    normalized = normalize_plan(plan)
    current = normalized.get("current_card_id")
    current_text = _text(current) if current not in (None, "") else None
    next_status = status or row.status
    next_config = config if config is not None else _json_load_object(row.config_json)
    before = _fingerprint(row)
    after = _json_dump(
        {
            "status": next_status,
            "config": next_config,
            "plan": normalized,
            "current_card_id": current_text,
        }
    )
    row.plan_json = _json_dump(normalized)
    row.current_card_id = current_text
    row.status = next_status
    if config is not None:
        row.config_json = _json_dump(next_config)
    if before == after:
        return False
    row.version = int(row.version or 0) + 1
    row.last_operation_id = operation_id
    row.updated_at = utc_now_naive()
    return True


def _new_round_id(session: Session, requested: str | None) -> str:
    rid = _text(requested)
    if rid and session.get(FreestyleRoundState, rid) is None:
        return rid[:128]
    return str(uuid.uuid4())


def _create_row(
    session: Session,
    *,
    round_id: str,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
) -> FreestyleRoundState:
    plan = plan_from_cards(cards)
    now = utc_now_naive()
    row = FreestyleRoundState(
        round_id=round_id[:128],
        scope_key=_text(scope_key)[:256],
        status="active",
        version=1,
        config_json=_json_dump(config or {}),
        plan_json=_json_dump(plan),
        current_card_id=plan.get("current_card_id"),
        last_operation_id=operation_id,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    return row


def _complete_active(session: Session, scope_key: str, *, except_id: str | None = None) -> None:
    now = utc_now_naive()
    rows = (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.scope_key == _text(scope_key)[:256],
            FreestyleRoundState.status == "active",
        )
        .all()
    )
    keep = _text(except_id)
    for row in rows:
        if keep and row.round_id == keep:
            continue
        row.status = "completed"
        row.version = int(row.version or 0) + 1
        row.updated_at = now


def get_round(session: Session, round_id: str) -> dict[str, Any] | None:
    row = _row_by_id(session, round_id)
    return _payload(row) if row is not None else None


def get_active_round(session: Session, scope_key: str) -> dict[str, Any] | None:
    row = _active_row(session, scope_key)
    return _payload(row) if row is not None else None


def get_or_create_active_round(
    session: Session,
    *,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
    round_id: str | None = None,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    key = _text(scope_key)
    if not key:
        raise ValueError("scope_key is required")
    row = _active_row(session, key)
    if row is not None:
        if op_id and row.last_operation_id == op_id:
            return _payload(row, duplicate=True)
        if cards:
            next_plan = rebind_plan_cards(_plan_of(row), cards)
            changed = _apply_plan(row, next_plan, operation_id=op_id)
            if changed:
                session.commit()
        return _payload(row)
    row = _create_row(
        session,
        round_id=_new_round_id(session, round_id),
        scope_key=key,
        config=config or {},
        cards=list(cards or []),
        operation_id=op_id,
    )
    session.commit()
    return _payload(row)


def start_new_round(
    session: Session,
    *,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
    round_id: str | None = None,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    key = _text(scope_key)
    if not key:
        raise ValueError("scope_key is required")
    active = _active_row(session, key)
    if active is not None and active.last_operation_id == op_id:
        return _payload(active, duplicate=True)
    _complete_active(session, key)
    row = _create_row(
        session,
        round_id=_new_round_id(session, round_id),
        scope_key=key,
        config=config or {},
        cards=list(cards or []),
        operation_id=op_id,
    )
    session.commit()
    return _payload(row)


def apply_round_action(
    session: Session,
    *,
    round_id: str,
    action: str,
    operation_id: str,
    expected_version: int,
    **fields: Any,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if op_id and row.last_operation_id == op_id:
        return _payload(row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return _payload(row, conflict=True)
    name = _text(action)
    if name not in _ACTIONS:
        raise ValueError(f"unknown round action: {action}")
    if row.status != "active" and name != "bind_cards":
        raise ValueError("freestyle round is not active")
    plan = _plan_of(row)
    card_id = _text(fields.get("card_id"))
    occurrence_id = _text(fields.get("occurrence_id"))
    encounter_id = _text(fields.get("encounter_id"))
    raw_cards = fields.get("cards")
    cards: list[dict[str, Any]] = raw_cards if isinstance(raw_cards, list) else []
    if name == "set_cursor":
        plan = set_cursor(plan, card_id, commit=True)
    elif name == "leave_card":
        plan = leave_card(plan, card_id or occurrence_id)
    elif name == "skip":
        plan = skip_card(plan, card_id)
    elif name == "complete":
        plan = complete_card(plan, card_id or occurrence_id)
    elif name == "exclude":
        plan = exclude_card(plan, card_id or occurrence_id)
    elif name == "restore":
        plan = restore_card(plan, card_id or occurrence_id)
    elif name == "bind_cards":
        plan = rebind_plan_cards(plan, cards)
    elif name == "set_encounter":
        plan = set_encounter(plan, card_id, encounter_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if changed:
        session.commit()
    else:
        row.last_operation_id = op_id
        session.commit()
    return _payload(row)


def apply_round_rating(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    card_id: str,
    occurrence_id: str,
    encounter_id: str,
    rating: int,
    unit_id: str | None = None,
    unit_revision: int | None = None,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if op_id and row.last_operation_id == op_id:
        return _payload(row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return _payload(row, conflict=True)
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    plan = apply_rating(
        _plan_of(row),
        card_id=card_id,
        rating=int(rating),
        encounter_id=encounter_id,
        occurrence_id=occurrence_id or "",
        unit_id=unit_id or "",
        round_id=row.round_id,
        unit_revision=unit_revision,
    )
    changed = _apply_plan(row, plan, operation_id=op_id)
    if changed:
        session.commit()
    else:
        row.last_operation_id = op_id
        session.commit()
    return _payload(row)


def rate_freestyle_round_unit(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    card_id: str,
    occurrence_id: str,
    encounter_id: str,
    rating: int,
    study_session_id: str,
    unit_id: str,
    unit_revision: int,
    palace_batch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    # Ratings last-write-wins: a stale expected_version still applies so PWA
    # and desktop cannot 409 each other after one side already scored.

    item: dict[str, Any] | None = None
    batch = palace_batch if isinstance(palace_batch, dict) else None
    if batch:
        current = batch.get("current")
        if not isinstance(current, dict):
            current = {
                "study_session_id": study_session_id,
                "unit_id": unit_id,
                "unit_revision": unit_revision,
                "encounter_id": encounter_id,
            }
        item = rate_palace_due_units(
            session,
            palace_id=int(batch.get("palace_id") or 0),
            operation_id=op_id,
            rating=rating,
            round_id=row.round_id,
            current=current,
            exclude_unit_ids=[str(value) for value in batch.get("exclude_unit_ids") or []],
            include_unit_ids=[str(value) for value in batch.get("include_unit_ids") or []],
        )
    elif _text(unit_id) and _text(study_session_id):
        item = rate_review_unit(
            session,
            study_session_id=study_session_id,
            unit_id=unit_id,
            unit_revision=int(unit_revision or 0),
            encounter_id=encounter_id,
            operation_id=op_id,
            rating=rating,
            round_id=row.round_id,
        )

    if row.last_operation_id == op_id:
        return {"item": item, "round": _payload(row, duplicate=True)}

    payload = apply_round_rating(
        session,
        round_id=row.round_id,
        operation_id=op_id,
        expected_version=0,
        card_id=card_id,
        occurrence_id=occurrence_id or "",
        encounter_id=encounter_id,
        rating=rating,
        unit_id=unit_id,
        unit_revision=unit_revision,
    )
    return {"item": item, "round": payload}
