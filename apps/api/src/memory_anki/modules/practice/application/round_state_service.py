"""Persistent, optimistic freestyle round plan facade."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.memory.api import rate_palace_due_units, rate_review_unit
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
)
from memory_anki.modules.practice.domain.feed_config import (
    queue_construction_signature,
    sanitize_feed_config,
)
from memory_anki.modules.practice.domain.overlay_quiz import (
    apply_overlay_progress,
    drop_overlay_for_palaces,
    empty_overlay_quiz,
    merge_overlay_quiz,
    normalize_overlay_quiz,
)
from memory_anki.modules.practice.domain.peer_progress import (
    apply_peer_progress,
    apply_peer_restore,
    progress_identity,
)
from memory_anki.modules.practice.domain.round_plan import (
    PASS_RATINGS,
    apply_rating,
    cleared_review_palace_ids,
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
from memory_anki.modules.practice.domain.workspace import (
    normalize_workspace,
    peer_workspace,
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


def _progress_identity_in_plan(plan: dict[str, Any], card_id: str) -> str:
    target = _text(card_id)
    for item in plan.get("original_cards") or []:
        if isinstance(item, dict) and _text(item.get("card_id")) == target:
            return progress_identity(item, card_id=target)
    return progress_identity({"card_id": target}, card_id=target)


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


def _row_by_id(session: Session, round_id: str) -> FreestyleRoundState | None:
    rid = _text(round_id)
    if not rid:
        return None
    return session.get(FreestyleRoundState, rid)


def _active_row(
    session: Session,
    scope_key: str,
    workspace: str = "primary",
) -> FreestyleRoundState | None:
    key = _text(scope_key)[:256]
    if not key:
        return None
    slot = normalize_workspace(workspace)
    return (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.workspace == slot,
            FreestyleRoundState.scope_key == key,
            FreestyleRoundState.status == "active",
        )
        .order_by(FreestyleRoundState.updated_at.desc())
        .first()
    )


def _latest_active_for_workspace(session: Session, workspace: str) -> FreestyleRoundState | None:
    slot = normalize_workspace(workspace)
    return (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.workspace == slot,
            FreestyleRoundState.status == "active",
        )
        .order_by(FreestyleRoundState.updated_at.desc(), FreestyleRoundState.round_id.desc())
        .first()
    )


def _peer_plan(session: Session, workspace: str) -> dict[str, Any] | None:
    peer = _latest_active_for_workspace(session, peer_workspace(workspace))
    return _plan_of(peer) if peer is not None else None


def _seed_from_peer(
    session: Session,
    plan: dict[str, Any],
    *,
    workspace: str,
    round_id: str,
    preserve_cursor: bool,
) -> dict[str, Any]:
    peer_plan = _peer_plan(session, workspace)
    if peer_plan is None:
        return normalize_plan(plan)
    return apply_peer_progress(
        plan,
        peer_plan,
        round_id=round_id,
        preserve_cursor=preserve_cursor,
    )


def _sync_peer_progress(
    session: Session,
    source_row: FreestyleRoundState,
    operation_id: str,
    *,
    restore_identity: str = "",
) -> None:
    peer = _latest_active_for_workspace(session, peer_workspace(source_row.workspace))
    if peer is None or peer.round_id == source_row.round_id:
        return
    if restore_identity:
        next_plan = apply_peer_restore(_plan_of(peer), restore_identity, preserve_cursor=True)
    else:
        next_plan = apply_peer_progress(
            _plan_of(peer),
            _plan_of(source_row),
            round_id=peer.round_id,
            preserve_cursor=True,
        )
    _apply_plan(peer, next_plan, operation_id=f"{operation_id}:peer")


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


def _carry_overlay_quiz(session: Session, workspace: str) -> dict[str, Any]:
    """Copy 做题 progress from the latest round in this workspace."""
    slot = normalize_workspace(workspace)
    row = (
        session.query(FreestyleRoundState)
        .filter(FreestyleRoundState.workspace == slot)
        .order_by(FreestyleRoundState.updated_at.desc(), FreestyleRoundState.round_id.desc())
        .first()
    )
    if row is None:
        return empty_overlay_quiz()
    plan = _plan_of(row)
    overlay = normalize_overlay_quiz(
        plan.get("overlay_quiz") if isinstance(plan.get("overlay_quiz"), dict) else None
    )
    return drop_overlay_for_palaces(overlay, cleared_review_palace_ids(plan))


def _clear_scored_palace_overlay(plan: dict[str, Any]) -> dict[str, Any]:
    next_plan = normalize_plan(plan)
    next_plan["overlay_quiz"] = drop_overlay_for_palaces(
        next_plan.get("overlay_quiz"),
        cleared_review_palace_ids(next_plan),
    )
    return next_plan


def _create_row(
    session: Session,
    *,
    round_id: str,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
    workspace: str = "primary",
    overlay_quiz: dict[str, Any] | None = None,
) -> FreestyleRoundState:
    slot = normalize_workspace(workspace)
    plan = normalize_plan(plan_from_cards(cards))
    plan["overlay_quiz"] = normalize_overlay_quiz(overlay_quiz)
    plan = apply_peer_progress(
        plan,
        _peer_plan(session, slot),
        round_id=round_id[:128],
        preserve_cursor=False,
    )
    now = utc_now_naive()
    row = FreestyleRoundState(
        round_id=round_id[:128],
        workspace=slot,
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


def _complete_active(
    session: Session,
    scope_key: str,
    *,
    workspace: str = "primary",
    except_id: str | None = None,
) -> None:
    now = utc_now_naive()
    rows = (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.workspace == normalize_workspace(workspace),
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


def get_active_round(
    session: Session,
    scope_key: str,
    workspace: str = "primary",
) -> dict[str, Any] | None:
    row = _active_row(session, scope_key, workspace)
    return _payload(row) if row is not None else None


def get_or_create_active_round(
    session: Session,
    *,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
    round_id: str | None = None,
    workspace: str = "primary",
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    key = _text(scope_key)
    if not key:
        raise ValueError("scope_key is required")
    slot = normalize_workspace(workspace)
    row = _active_row(session, key, slot)
    if row is not None:
        if op_id and row.last_operation_id == op_id:
            return _payload(row, duplicate=True)
        next_config = sanitize_feed_config(config or {})
        previous_config = _json_load_object(row.config_json)
        reorder = queue_construction_signature(previous_config) != queue_construction_signature(
            next_config
        )
        if cards:
            next_plan = rebind_plan_cards(
                _plan_of(row),
                cards,
                reorder_unstarted=reorder,
            )
            next_plan = _clear_scored_palace_overlay(next_plan)
            next_plan = _seed_from_peer(
                session,
                next_plan,
                workspace=slot,
                round_id=row.round_id,
                preserve_cursor=True,
            )
            changed = _apply_plan(
                row,
                next_plan,
                operation_id=op_id,
                config=next_config if reorder else None,
            )
            if changed:
                session.commit()
        elif reorder:
            changed = _apply_plan(
                row,
                _plan_of(row),
                operation_id=op_id,
                config=next_config,
            )
            if changed:
                session.commit()
        return _payload(row)
    overlay = _carry_overlay_quiz(session, slot)
    row = _create_row(
        session,
        round_id=_new_round_id(session, round_id),
        scope_key=key,
        config=config or {},
        cards=list(cards or []),
        operation_id=op_id,
        workspace=slot,
        overlay_quiz=overlay,
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
    workspace: str = "primary",
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    key = _text(scope_key)
    if not key:
        raise ValueError("scope_key is required")
    slot = normalize_workspace(workspace)
    active = _active_row(session, key, slot)
    if active is not None and active.last_operation_id == op_id:
        return _payload(active, duplicate=True)
    overlay = _carry_overlay_quiz(session, slot)
    _complete_active(session, key, workspace=slot)
    row = _create_row(
        session,
        round_id=_new_round_id(session, round_id),
        scope_key=key,
        config=config or {},
        cards=list(cards or []),
        operation_id=op_id,
        workspace=slot,
        overlay_quiz=overlay,
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
    restore_identity = ""
    target_id = card_id or occurrence_id
    if name == "set_cursor":
        plan = set_cursor(plan, card_id, commit=True)
    elif name == "leave_card":
        plan = leave_card(plan, target_id)
    elif name == "skip":
        plan = skip_card(plan, card_id)
    elif name == "complete":
        plan = complete_card(plan, target_id)
    elif name == "exclude":
        plan = exclude_card(plan, target_id)
    elif name == "restore":
        restore_identity = _progress_identity_in_plan(plan, target_id)
        plan = restore_card(plan, target_id)
    elif name == "bind_cards":
        plan = rebind_plan_cards(plan, cards)
        plan = _seed_from_peer(
            session,
            plan,
            workspace=normalize_workspace(row.workspace),
            round_id=row.round_id,
            preserve_cursor=True,
        )
    elif name == "set_encounter":
        plan = set_encounter(plan, card_id, encounter_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if name in {"leave_card", "complete", "exclude", "restore", "bind_cards"}:
        _sync_peer_progress(session, row, op_id, restore_identity=restore_identity)
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
    plan = _clear_scored_palace_overlay(plan)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
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
    palace_id = int(batch.get("palace_id") or 0) if batch else 0
    if palace_id > 0 and int(rating) in PASS_RATINGS:
        latest = _row_by_id(session, row.round_id)
        if latest is not None:
            plan = _plan_of(latest)
            plan["overlay_quiz"] = drop_overlay_for_palaces(plan.get("overlay_quiz"), {palace_id})
            if _apply_plan(latest, plan, operation_id=op_id):
                _sync_peer_progress(session, latest, op_id)
                session.commit()
            payload = _payload(latest)
    return {"item": item, "round": payload}


def _begin_round_write(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
) -> tuple[FreestyleRoundState | None, dict[str, Any] | None]:
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if op_id and row.last_operation_id == op_id:
        return None, _payload(row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return None, _payload(row, conflict=True)
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    return row, None


def ensure_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None:
        return early
    assert row is not None
    pack = build_overlay_question_pack(session, config if isinstance(config, dict) else _json_load_object(row.config_json))
    plan = _plan_of(row)
    overlay = merge_overlay_quiz(plan.get("overlay_quiz"), **pack)
    plan["overlay_quiz"] = drop_overlay_for_palaces(overlay, cleared_review_palace_ids(plan))
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
    if not changed:
        row.last_operation_id = op_id
    session.commit()
    return _payload(row)


def progress_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    current_index: int = 0,
    completed_ids: list[int] | None = None,
    states: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None:
        return early
    assert row is not None
    plan = _plan_of(row)
    plan["overlay_quiz"] = apply_overlay_progress(
        plan.get("overlay_quiz"),
        current_index=current_index,
        completed_ids=list(completed_ids or []),
        states=states if isinstance(states, dict) else {},
    )
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
    if not changed:
        row.last_operation_id = op_id
    session.commit()
    return _payload(row)
