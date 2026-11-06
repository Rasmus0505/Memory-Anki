"""Persistent, optimistic freestyle round plan facade."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_day, parse_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import (
    FreestyleRoundState,
)
from memory_anki.modules.memory.api import (
    list_due_review_unit_ids,
    list_unit_node_members,
    rate_palace_due_units,
    rate_review_unit,
)
from memory_anki.modules.practice.domain.feed_config import (
    queue_construction_signature,
    sanitize_feed_config,
)
from memory_anki.modules.practice.domain.overlay_quiz import (
    clear_overlay_wrong_states,
    empty_overlay_quiz,
    normalize_overlay_quiz,
)
from memory_anki.modules.practice.domain.round_commands import (
    ApplyRating,
    CompressCompleted,
    LeaveCard,
    MoveCursor,
    apply_command,
)
from memory_anki.modules.practice.domain.round_plan import (
    assert_rating_identity,
    bedtime_card_ids,
    complete_card,
    exclude_card,
    normalize_plan,
    plan_from_cards,
    plan_is_fully_handled,
    restore_card,
    set_encounter,
    skip_card,
)
from memory_anki.modules.practice.domain.round_rebind import (
    append_today_cards,
    replan_remaining,
)
from memory_anki.modules.practice.domain.round_uncomplete import uncomplete_card
from memory_anki.modules.practice.domain.workspace import normalize_workspace
from memory_anki.modules.quiz.public.queries import list_node_bindings_for_palaces

from .round_commit import commit_operation
from .round_plan_cleanup import (
    plan_card_units,
    plan_unit_ids,
    without_undue_units,
    without_vanished_units,
)
from .round_read_lookups import (
    latest_active_round,
    operation_already_applied,
)
from .round_state_extras import added_extra_palace_ids, extra_cards, local_today
from .round_state_payload import (
    _fingerprint,
    _json_dump,
    _json_load_object,
    _plan_of,
    _serve,
)
from .round_state_payload import (
    _json_object as _json_object,
)

_ACTIONS = {
    "set_cursor",
    "leave_card",
    "skip",
    "complete",
    "uncomplete",
    "exclude",
    "restore",
    "compress_completed",
    "bind_cards",
    "set_encounter",
}


def _text(value: Any) -> str:
    return str(value or "").strip()



def _require_operation_id(operation_id: str | None) -> str:
    op_id = _text(operation_id)
    if not op_id:
        raise ValueError("operation_id is required")
    return op_id


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
    """Active round for a slot. See ``round_read_lookups`` for the autoflush rule."""
    return latest_active_round(session, workspace)



def _apply_plan(
    row: FreestyleRoundState,
    plan: dict[str, Any],
    *,
    operation_id: str,
    config: dict[str, Any] | None = None,
    status: str | None = None,
    scope_key: str | None = None,
) -> bool:
    normalized = normalize_plan(plan)
    current = normalized.get("current_card_id")
    current_text = _text(current) if current not in (None, "") else None
    next_status = status or row.status
    next_config = config if config is not None else _json_load_object(row.config_json)
    next_scope = _text(scope_key)[:256] if scope_key is not None else row.scope_key
    before = _fingerprint(row)
    after = _json_dump(
        {
            "status": next_status,
            "config": next_config,
            "plan": normalized,
            "current_card_id": current_text,
            "scope_key": next_scope,
        }
    )
    row.plan_json = _json_dump(normalized)
    row.current_card_id = current_text
    row.status = next_status
    if config is not None:
        row.config_json = _json_dump(next_config)
    if scope_key is not None:
        row.scope_key = next_scope
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
    workspace: str = "primary",
    overlay_quiz: dict[str, Any] | None = None,
) -> FreestyleRoundState:
    slot = normalize_workspace(workspace)
    plan = normalize_plan(plan_from_cards(cards, today=local_today()))
    plan["overlay_quiz"] = normalize_overlay_quiz(overlay_quiz)
    now = utc_now_naive()
    row = FreestyleRoundState(
        round_id=round_id[:128],
        workspace=slot,
        scope_key=_text(scope_key)[:256],
        status="active",
        version=1,
        # Store the same sanitized shape the update path writes, so hydration
        # never has to distinguish "created from raw client config" rounds.
        config_json=_json_dump(sanitize_feed_config(config or {})),
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
    *,
    workspace: str = "primary",
    except_id: str | None = None,
) -> None:
    now = utc_now_naive()
    rows = (
        session.query(FreestyleRoundState)
        .filter(
            FreestyleRoundState.workspace == normalize_workspace(workspace),
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
    return _serve(session, row) if row is not None else None


def get_active_round(
    session: Session,
    scope_key: str,
    workspace: str = "primary",
) -> dict[str, Any] | None:
    row = _active_row(session, scope_key, workspace)
    return _serve(session, row) if row is not None else None


def read_workspace_active_round(
    session: Session,
    *,
    workspace: str = "primary",
) -> dict[str, Any] | None:
    """Read the workspace's current round. Never creates, replans, or appends cards."""
    slot = normalize_workspace(workspace)
    row = _latest_active_for_workspace(session, slot)
    return _serve(session, row) if row is not None else None


def get_or_create_active_round(
    session: Session,
    *,
    scope_key: str,
    config: dict[str, Any],
    cards: list[dict[str, Any]],
    operation_id: str,
    round_id: str | None = None,
    workspace: str = "primary",
    replan: bool = False,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    key = _text(scope_key)
    if not key:
        raise ValueError("scope_key is required")
    slot = normalize_workspace(workspace)
    row = _active_row(session, key, slot)
    if row is None:
        row = _latest_active_for_workspace(session, slot)
    if row is not None:
        if op_id and _operation_seen(session, row, op_id):
            return _serve(session, row, duplicate=True)
        next_config = sanitize_feed_config(config or {})
        previous_config = _json_load_object(row.config_json)
        reorder = queue_construction_signature(previous_config) != queue_construction_signature(
            next_config
        )
        scope_changed = _text(row.scope_key) != key[:256]
        persist_config = reorder or scope_changed or replan
        added_extra_ids = added_extra_palace_ids(previous_config, next_config)
        # Any other settings change (today: 加入本轮's extra_palace_ids) still
        # becomes the round's stored config. Without this, the next hydration
        # resurrects the old selection and silently drops the addition. It must
        # not replan the queue: extras append, they do not reorder existing work.
        write_config = persist_config or sanitize_feed_config(previous_config) != next_config
        before_plan = _plan_of(row)
        before_ids = [item["card_id"] for item in before_plan.get("original_cards") or []]
        before_units = plan_card_units(before_plan)
        before_presented = list(before_plan.get("presented_ids") or [])
        # without_vanished_units applies drop_vanished_unstarted with successor
        # rekeying, so a retired mark's card follows its content in place.
        next_plan = without_undue_units(session, without_vanished_units(session, _plan_of(row)))
        # A card re-pointed at a successor unit is a real change even though the
        # card id list is unchanged; without this it would never be persisted.
        rebound = plan_card_units(next_plan) != before_units
        dropped = [item["card_id"] for item in next_plan.get("original_cards") or []] != before_ids
        today = local_today()
        plan_day = str(next_plan.get("today") or "")[:10]
        same_day = plan_day in {"", today}
        day_advanced = bool(plan_day and plan_day < today)
        # A round that outlives a study day must re-admit the units that are due
        # again today. The client rebuilds its candidates from the round ledger,
        # which still hides yesterday's finished cards — exactly the ones due
        # again — so the server supplies its own due set for this plan's units
        # instead of trusting the incoming list.
        due_again = (
            list_due_review_unit_ids(session, plan_unit_ids(next_plan), today=local_day())
            if day_advanced
            else set()
        )
        before_handled = (
            tuple(next_plan.get("completed_ids") or []),
            tuple(next_plan.get("compressed_ids") or []),
        )
        # Fully handled rounds freeze on get_or_create: silent post-complete
        # rebuilds must not mint or append leftover due into the live feed, or
        # the closing settlement slot disappears. /rounds/start advances.
        # An explicit 「加入本轮」 is the one exception: append only that palace's
        # cards, never the rest of the incoming (possibly leftover) queue.
        cards_for_extras = extra_cards(cards, added_extra_ids)
        reopen_for_extras = plan_is_fully_handled(next_plan) and bool(cards_for_extras)
        if plan_is_fully_handled(next_plan) and not persist_config and same_day and not reopen_for_extras:
            if _apply_plan(row, next_plan, operation_id=op_id):
                if not _commit_operation(session, row, op_id):
                    return _serve(session, row, conflict=True)
            return _serve(session, row)
        if persist_config:
            next_plan = replan_remaining(
                next_plan, cards, today=today, due_unit_ids=sorted(due_again)
            )
            next_plan = normalize_plan(next_plan)
        elif cards or due_again or reopen_for_extras:
            incoming = cards_for_extras if reopen_for_extras else cards
            next_plan = append_today_cards(
                next_plan, incoming, today=today, due_unit_ids=sorted(due_again)
            )
            next_plan = normalize_plan(next_plan)
        # A client may resend a card whose palace was deleted. Drop it again
        # after append/replan so it cannot come back as a live retry or a new row.
        next_plan = without_undue_units(session, without_vanished_units(session, next_plan))
        dropped = [item["card_id"] for item in next_plan.get("original_cards") or []] != before_ids
        presented_changed = list(next_plan.get("presented_ids") or []) != before_presented
        handled_changed = before_handled != (
            tuple(next_plan.get("completed_ids") or []),
            tuple(next_plan.get("compressed_ids") or []),
        )
        if (
            cards
            or persist_config
            or dropped
            or rebound
            or presented_changed
            or handled_changed
        ):
            changed = _apply_plan(
                row,
                next_plan,
                operation_id=op_id,
                config=next_config if write_config else None,
                scope_key=key if scope_changed else None,
            )
            if changed:
                if not _commit_operation(session, row, op_id):
                    return _serve(session, row, conflict=True)
        return _serve(session, row)
    overlay = empty_overlay_quiz()
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
    # A freshly created row cannot lose a version race, so the result is moot.
    _commit_operation(session, row, op_id)
    return _serve(session, row)


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
    if active is not None and _operation_seen(session, active, op_id):
        return _serve(session, active, duplicate=True)
    overlay = empty_overlay_quiz()
    _complete_active(session, workspace=slot)
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
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


def _settled_unit_ids(
    plan: dict[str, Any],
    *,
    card_ids: list[str],
    explicit_unit_ids: list[str],
) -> set[str]:
    normalized = normalize_plan(plan)
    original = {str(card.get("card_id")): card for card in normalized.get("original_cards") or []}
    occurrences = {str(item.get("occurrence_id")): item for item in normalized.get("occurrences") or []}
    units = {str(item).strip() for item in explicit_unit_ids if str(item).strip()}
    for card_id in card_ids:
        key = str(card_id or "").strip()
        card = original.get(key)
        if card is None and key in occurrences:
            card = original.get(str(occurrences[key].get("source_card_id") or ""))
        unit_id = str((card or {}).get("unit_id") or "").strip()
        if unit_id:
            units.add(unit_id)
    return units


def _settle_round_wrong_markers(
    session: Session,
    plan: dict[str, Any],
    *,
    card_ids: list[str],
    explicit_unit_ids: list[str],
) -> dict[str, Any]:
    """Clear this round's wrong markers for the units a 小结算 just settled.

    The progress rail's unit marker and the node badges read the same lifetime:
    a settled unit is done, so both stop reporting it. Questions of units that
    were not settled keep their marker, including after a correct retry.
    """
    unit_ids = _settled_unit_ids(plan, card_ids=card_ids, explicit_unit_ids=explicit_unit_ids)
    if not unit_ids:
        return plan
    next_plan = {
        **plan,
        "wrong_unit_ids": [item for item in plan["wrong_unit_ids"] if item not in unit_ids],
    }
    members = list_unit_node_members(session, sorted(unit_ids))
    node_uids = {uid for values in members.values() for uid in values}
    if not node_uids:
        return next_plan
    palace_ids = {
        int(card.get("palace_id"))
        for card in plan.get("original_cards") or []
        if str(card.get("unit_id") or "").strip() in unit_ids and card.get("palace_id")
    }
    bindings = list_node_bindings_for_palaces(session, palace_ids=sorted(palace_ids))
    question_ids = {
        int(binding["question_id"])
        for binding in bindings
        if str(binding.get("node_uid") or "") in node_uids
        and str(binding.get("question_id") or "").isdigit()
    }
    if not question_ids:
        return next_plan
    next_plan["wrong_question_ids"] = [
        item for item in plan["wrong_question_ids"]
        if not (str(item).isdigit() and int(item) in question_ids)
    ]
    next_plan["overlay_quiz"] = clear_overlay_wrong_states(plan.get("overlay_quiz"), question_ids)
    return next_plan


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
    if op_id and _operation_seen(session, row, op_id):
        return _serve(session, row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return _serve(session, row, conflict=True)
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
    target_id = card_id or occurrence_id
    if name == "set_cursor":
        plan, _ = apply_command(plan, MoveCursor(card_id))
    elif name == "leave_card":
        plan, _ = apply_command(plan, LeaveCard(target_id))
    elif name == "skip":
        plan = skip_card(plan, card_id)
    elif name == "complete":
        plan = complete_card(plan, target_id)
    elif name == "uncomplete":
        plan = uncomplete_card(plan, target_id)
    elif name == "exclude":
        # This round only. Same arrangement as 记得/轻松, without a rating or a schedule write.
        plan = exclude_card(plan, target_id)
    elif name == "restore":
        plan = restore_card(plan, target_id)
    elif name == "compress_completed":
        raw_settlement = fields.get("partial_settlement")
        settlement = raw_settlement if isinstance(raw_settlement, dict) else None
        before_compressed = set(str(item) for item in plan.get("compressed_ids") or [])
        plan, _ = apply_command(plan, CompressCompleted(settlement))
        newly_compressed = [
            str(item) for item in plan.get("compressed_ids") or []
            if str(item) not in before_compressed
        ]
        explicit_card_ids = [
            str(item) for item in (settlement or {}).get("card_ids") or []
            if str(item).strip()
        ]
        explicit_unit_ids = [
            str(item) for item in (settlement or {}).get("settled_unit_ids") or []
            if str(item).strip()
        ]
        plan = _settle_round_wrong_markers(
            session,
            plan,
            card_ids=newly_compressed or explicit_card_ids,
            explicit_unit_ids=explicit_unit_ids,
        )
    elif name == "bind_cards":
        plan = append_today_cards(plan, cards, today=local_today())
        plan = normalize_plan(plan)
    elif name == "set_encounter":
        plan = set_encounter(plan, card_id, encounter_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


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
    available_at: datetime | None = None,
    intraday_kind: str | None = None,
    intraday_exhausted: bool = False,
) -> dict[str, Any]:
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if op_id and _operation_seen(session, row, op_id):
        return _serve(session, row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return _serve(session, row, conflict=True)
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    plan, _ = apply_command(
        _plan_of(row),
        ApplyRating(
            card_id=card_id,
            rating=int(rating),
            encounter_id=encounter_id,
            occurrence_id=occurrence_id or "",
            unit_id=unit_id or "",
            round_id=row.round_id,
            unit_revision=unit_revision,
            available_at=available_at,
            intraday_kind=intraday_kind,
            intraday_exhausted=intraday_exhausted,
        ),
    )
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


def rate_freestyle_round_unit(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    intent_sequence: int = 0,
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
    if _operation_seen(session, row, op_id):
        return {"item": None, "round": _serve(session, row, duplicate=True)}
    if _text(card_id) in bedtime_card_ids(_plan_of(row)):
        # A bedtime pass must never reach the scheduling ledger. The client uses
        # the plan-only endpoint; this guard makes that impossible to bypass.
        raise ValueError("睡前复习只记录评分，不改变复习安排")
    # Ratings last-write-wins: a stale expected_version still applies so PWA
    # and desktop cannot 409 each other after one side already scored.
    # Wrong card / occurrence / encounter / unit never last-writes.
    assert_rating_identity(
        _plan_of(row),
        card_id=card_id,
        occurrence_id=occurrence_id or "",
        encounter_id=encounter_id,
        unit_id=unit_id,
    )

    occurrence = next(
        (entry for entry in _plan_of(row).get("occurrences", [])
         if entry.get("occurrence_id") == occurrence_id),
        None,
    )
    attempt_identity = {
        "card_id": card_id,
        "occurrence_id": occurrence_id or "",
        "retry_attempt": int((occurrence or {}).get("retry_attempt") or 0),
    }
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
            current={**current, **attempt_identity},
            exclude_unit_ids=[str(value) for value in batch.get("exclude_unit_ids") or []],
            include_unit_ids=[str(value) for value in batch.get("include_unit_ids") or []],
            commit=False,
            adopt_live_revision=True,
        )
    elif _text(unit_id):
        # An empty study_session_id is valid: the unit service reopens the glance
        # for this encounter inside the same write.
        item = rate_review_unit(
            session,
            study_session_id=study_session_id,
            unit_id=unit_id,
            unit_revision=int(unit_revision or 0),
            encounter_id=encounter_id,
            operation_id=op_id,
            rating=rating,
            round_id=row.round_id,
            commit=False,
            card_id=card_id,
            occurrence_id=occurrence_id or "",
            retry_attempt=int((occurrence or {}).get("retry_attempt") or 0),
            adopt_live_revision=True,
        )

    if _operation_seen(session, row, op_id):
        return {"item": item, "round": _serve(session, row, duplicate=True)}

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
        available_at=_parse_available_at(item),
        intraday_kind=_text_optional(item, "intraday_kind"),
        intraday_exhausted=bool((item or {}).get("intraday_exhausted")),
    )
    return {"item": item, "round": payload}


def _parse_available_at(item: dict[str, Any] | None) -> datetime | None:
    """The rating response carries an offset-aware instant; storage is naive UTC."""
    raw = str((item or {}).get("intraday_due_at") or "").strip()
    if not raw:
        return None
    return parse_api_datetime(raw)


def _text_optional(item: dict[str, Any] | None, key: str) -> str | None:
    value = str((item or {}).get(key) or "").strip()
    return value or None


def _operation_seen(session: Session, row: FreestyleRoundState, operation_id: str) -> bool:
    """Has this operation already been applied? See ``round_read_lookups``."""
    return operation_already_applied(session, row, operation_id)


def _commit_operation(session: Session, row: FreestyleRoundState, operation_id: str) -> bool:
    """Commit a round write; False means a racing write won. See ``round_commit``."""
    return commit_operation(session, row, operation_id)


def _commit_plan(
    session: Session,
    row: FreestyleRoundState,
    plan: dict[str, Any],
    operation_id: str,
) -> dict[str, Any]:
    changed = _apply_plan(row, plan, operation_id=operation_id)
    if not changed:
        row.last_operation_id = operation_id
    if not _commit_operation(session, row, operation_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)



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
    if op_id and _operation_seen(session, row, op_id):
        return None, _serve(session, row, duplicate=True)
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return None, _serve(session, row, conflict=True)
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    return row, None
