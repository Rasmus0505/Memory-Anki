"""Cross-workspace freestyle progress inheritance. Framework-free."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .overlay_quiz import inherit_overlay_completed
from .round_plan import (
    OCCURRENCE_COMPLETED,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    Plan,
    _append_unique,
    _find_occurrence,
    _insert_retry_inplace,
    _int,
    _original_card,
    _predicted_insert_index,
    _repair_current,
    _settle_source,
    _sync_index,
    _text,
    normalize_plan,
    occurrence_id_for,
)


def progress_identity(card: Mapping[str, Any] | None, *, card_id: str = "") -> str:
    """Stable overlap key across workspaces. Revision is not part of identity."""
    payload = card if isinstance(card, Mapping) else {}
    unit_id = _text(payload.get("unit_id"))
    if unit_id:
        return f"unit:{unit_id}"
    raw_id = _text(payload.get("card_id") or payload.get("id") or card_id)
    if raw_id.startswith("quiz_question:"):
        return f"quiz:{raw_id.split(':', 1)[1]}"
    if raw_id.startswith("retry:"):
        return ""
    return f"card:{raw_id}" if raw_id else ""


def apply_peer_progress(
    plan: Mapping[str, Any],
    peer_plan: Mapping[str, Any] | None,
    *,
    round_id: str = "",
    preserve_cursor: bool = True,
) -> Plan:
    """Union overlapping complete / exclude / retry / overlay progress from a peer round.

    Never moves this plan's cursor when `preserve_cursor` is true. A new round
    should pass false so `_repair_current` can skip already-handled cards.
    """
    next_plan = normalize_plan(plan)
    peer = normalize_plan(peer_plan)
    preserved_current = _text(next_plan.get("current_card_id")) or None
    target_ids = _identity_to_source_id(next_plan)
    if not target_ids:
        next_plan["overlay_quiz"] = inherit_overlay_completed(
            next_plan.get("overlay_quiz"),
            peer.get("overlay_quiz"),
        )
        return next_plan

    peer_by_id = {item["card_id"]: item for item in peer["original_cards"]}

    def peer_identity_for(card_id: str) -> str:
        occ = _find_occurrence(peer, card_id)
        if occ is not None:
            source = _text(occ.get("source_card_id"))
            source_card = peer_by_id.get(source)
            ident = progress_identity(source_card, card_id=source)
            if ident:
                return ident
            source_unit = _text(occ.get("source_unit_id"))
            return f"unit:{source_unit}" if source_unit else ""
        return progress_identity(peer_by_id.get(card_id), card_id=card_id)

    completed_idents: set[str] = set()
    for completed_id in peer["completed_ids"]:
        ident = peer_identity_for(completed_id)
        target_id = target_ids.get(ident) if ident else None
        if not target_id:
            continue
        if _find_occurrence(peer, completed_id) is not None:
            continue
        completed_idents.add(ident)
        _append_unique(next_plan["completed_ids"], target_id)
        _settle_source(next_plan, target_id)

    for excluded_id in peer["excluded_ids"]:
        ident = peer_identity_for(excluded_id)
        target_id = target_ids.get(ident) if ident else None
        if not target_id or ident in completed_idents:
            continue
        if target_id in next_plan["completed_ids"]:
            continue
        _append_unique(next_plan["excluded_ids"], target_id)

    for occ in peer["occurrences"]:
        status = occ.get("status")
        if status not in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            continue
        ident = peer_identity_for(_text(occ.get("occurrence_id")) or _text(occ.get("source_card_id")))
        target_id = target_ids.get(ident) if ident else None
        if not target_id or target_id in next_plan["completed_ids"]:
            continue
        _align_peer_retry(
            next_plan,
            source_id=target_id,
            source_unit_id=_text((_original_card(next_plan, target_id) or {}).get("unit_id")),
            peer_occ=occ,
            round_id=round_id,
        )

    next_plan["overlay_quiz"] = inherit_overlay_completed(
        next_plan.get("overlay_quiz"),
        peer.get("overlay_quiz"),
    )
    if preserve_cursor:
        next_plan["current_card_id"] = preserved_current
        _sync_index(next_plan)
    else:
        _repair_current(next_plan)
    return next_plan


def apply_peer_restore(
    plan: Mapping[str, Any],
    identity: str,
    *,
    preserve_cursor: bool = True,
) -> Plan:
    next_plan = normalize_plan(plan)
    preserved_current = _text(next_plan.get("current_card_id")) or None
    target_id = _identity_to_source_id(next_plan).get(_text(identity))
    if target_id:
        next_plan["excluded_ids"] = [item for item in next_plan["excluded_ids"] if item != target_id]
    if preserve_cursor:
        next_plan["current_card_id"] = preserved_current
        _sync_index(next_plan)
    else:
        _repair_current(next_plan)
    return next_plan


def _identity_to_source_id(plan: Plan) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for card in plan["original_cards"]:
        ident = progress_identity(card)
        if ident and ident not in mapping:
            mapping[ident] = card["card_id"]
    return mapping


def _align_peer_retry(
    plan: Plan,
    *,
    source_id: str,
    source_unit_id: str,
    peer_occ: Mapping[str, Any],
    round_id: str,
) -> None:
    attempt = max(1, _int(peer_occ.get("retry_attempt")))
    existing = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == source_id and int(item.get("retry_attempt") or 0) == attempt
    ]
    status = _text(peer_occ.get("status")) or OCCURRENCE_PENDING
    source_key = source_unit_id or source_id
    if existing:
        occ = existing[0]
    else:
        occ = {
            "occurrence_id": occurrence_id_for(round_id, source_key, attempt),
            "source_card_id": source_id,
            "source_unit_id": source_unit_id,
            "retry_attempt": attempt,
            "rating": peer_occ.get("rating"),
            "insert_target_index": _predicted_insert_index(plan, source_id),
            "status": OCCURRENCE_PENDING,
            "encounter_id": _text(peer_occ.get("encounter_id")),
        }
        plan["occurrences"].append(occ)
    if status == OCCURRENCE_COMPLETED:
        occ["status"] = OCCURRENCE_COMPLETED
        _append_unique(plan["completed_ids"], occ["occurrence_id"])
        return
    if status == OCCURRENCE_INSERTED and occ["status"] != OCCURRENCE_INSERTED:
        source_index = 0
        if source_id in plan["presented_ids"]:
            source_index = plan["presented_ids"].index(source_id)
        _insert_retry_inplace(plan, occ["occurrence_id"], source_index)
        return
    if status == OCCURRENCE_PENDING and occ["status"] not in {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
        occ["status"] = OCCURRENCE_PENDING
