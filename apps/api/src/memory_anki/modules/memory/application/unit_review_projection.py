"""Permanent-mark review unit topology reconciliation and due projections."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitScheduleBatch,
    ReviewUnitState,
)
from memory_anki.modules.mindmap_document.api import (
    build_document_tree,
    permanent_mark_uids_from_nodes,
    split_scheduling_units,
)

from .unit_scheduler import INTERVAL_DAYS, clamp_stage


@dataclass(frozen=True)
class UnitDefinition:
    anchor_uid: str
    unit_kind: str
    title: str
    node_uids: tuple[str, ...]
    membership_hash: str
    content_hash: str


def json_load_list(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in value] if isinstance(value, list) else []


def _digest(values: list[str] | tuple[str, ...]) -> str:
    payload = "\n".join(values)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _schedule_snapshot(
    *,
    stage_index: int,
    due_date: date,
    has_passed: bool,
) -> dict[str, Any]:
    stage = clamp_stage(stage_index)
    return {
        "stage_index": stage,
        "interval_days": INTERVAL_DAYS[stage],
        "due_date": due_date.isoformat() if isinstance(due_date, date) else str(due_date),
        "has_passed": bool(has_passed),
    }


def _schedule_snapshot_from_row(row: ReviewUnitState) -> dict[str, Any]:
    return _schedule_snapshot(
        stage_index=row.stage_index,
        due_date=row.due_date,
        has_passed=row.has_passed,
    )


def _change_entry(
    *,
    unit_id: str,
    anchor_uid: str,
    title: str,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "unit_id": unit_id,
        "anchor_uid": anchor_uid,
        "title": title,
        "action": action,
        "before": before,
        "after": after,
    }


def resolve_unit_definitions(
    session: Session,
    palace_id: int,
) -> tuple[dict[str, Any], list[UnitDefinition]]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None or palace.archived:
        raise ValueError(f"palace not found: {palace_id}")
    return _definitions_for_palace(palace)


def _definitions_for_palace(
    palace: Palace,
) -> tuple[dict[str, Any], list[UnitDefinition]]:
    root_uid, nodes = build_document_tree(palace.editor_doc)
    tree = {
        "palace_id": palace.id,
        "title": palace.title or "",
        "root_uid": root_uid,
        "nodes": nodes,
    }
    if not root_uid:
        return tree, []
    marks = permanent_mark_uids_from_nodes(nodes, root_uid=str(root_uid))
    splits = split_scheduling_units(
        nodes=nodes,
        root_uid=str(root_uid),
        permanent_mark_uids=marks,
    )
    definitions: list[UnitDefinition] = []
    for split in splits:
        node_uids = tuple(str(uid) for uid in split.node_uids)
        membership_hash = _digest([split.unit_root_uid, split.kind, *node_uids])
        content_hash = _digest(
            [
                f"{uid}:{nodes.get(uid, {}).get('content_fingerprint') or ''}"
                for uid in node_uids
            ]
        )
        definitions.append(
            UnitDefinition(
                anchor_uid=str(split.unit_root_uid),
                unit_kind=str(split.kind),
                title=str(split.title or ""),
                node_uids=node_uids,
                membership_hash=membership_hash,
                content_hash=content_hash,
            )
        )
    return tree, definitions


def _active_states(session: Session, palace_id: int) -> list[ReviewUnitState]:
    return (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.palace_id == palace_id, ReviewUnitState.active.is_(True))
        .all()
    )


def _invalidate_active_sessions(session: Session, palace_id: int) -> int:
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.palace_id == palace_id,
            StudySession.scene.in_(("formal_unit_review", "freestyle_unit_review")),
            StudySession.status == "active",
        )
        .all()
    )
    now = utc_now_naive()
    for row in rows:
        row.status = "invalidated"
        row.ended_at = now
        row.completion_method = "unit_topology_changed"
        # An invalidated session is never resumable. Leaving an encounter open
        # made reloads look like a live card even though its frozen unit topology
        # had already changed. Close it without assigning a rating or duration.
        (
            session.query(ReviewUnitEncounter)
            .filter(
                ReviewUnitEncounter.study_session_id == row.id,
                ReviewUnitEncounter.status == "open",
            )
            .update(
                {
                    ReviewUnitEncounter.status: "closed",
                    ReviewUnitEncounter.closed_at: now,
                },
                synchronize_session=False,
            )
        )
    return len(rows)


def _parse_due_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError("due_date is required")
    return date.fromisoformat(text[:10])


def adjust_unit_schedule(
    session: Session,
    *,
    unit_id: str,
    operation_id: str,
    stage_index: int | None = None,
    due_date: date | str | None = None,
    has_passed: bool | None = None,
    reason: str = "manual_adjust",
) -> dict[str, Any]:
    """Manually set stage / due / has_passed on one active review unit.

    Does not change content_hash or membership. Bumps revision and invalidates
    active formal/freestyle review sessions for the palace.

    ``operation_id`` is required for client idempotency tracking; there is no
    dedicated ops table for manual adjusts in this private product, so each
    call with a non-empty operation_id simply applies the patch once.
    """
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")
    row = session.get(ReviewUnitState, str(unit_id or "").strip())
    if row is None or not row.active:
        raise ValueError(f"review unit not found: {unit_id}")
    if stage_index is None and due_date is None and has_passed is None:
        raise ValueError("at least one of stage_index, due_date, has_passed is required")

    before = _schedule_snapshot_from_row(row)
    if stage_index is not None:
        row.stage_index = clamp_stage(int(stage_index))
    if due_date is not None:
        row.due_date = _parse_due_date(due_date)
    if has_passed is not None:
        row.has_passed = bool(has_passed)
    row.revision += 1
    after = _schedule_snapshot_from_row(row)
    invalidated = _invalidate_active_sessions(session, row.palace_id)
    session.flush()

    definition = None
    try:
        _tree, definitions = resolve_unit_definitions(session, row.palace_id)
        definition = next(
            (item for item in definitions if item.anchor_uid == row.anchor_uid),
            None,
        )
    except ValueError:
        definition = None

    palace = get_palace_unit_projection(session, row.palace_id)
    return {
        "operation_id": op_id,
        "reason": str(reason or "manual_adjust").strip() or "manual_adjust",
        "unit": unit_payload(row, definition),
        "before": before,
        "after": after,
        "invalidated_session_count": invalidated,
        "palace": {
            "palace_id": palace["palace_id"],
            "title": palace.get("title") or "",
            "unit_count": palace.get("unit_count"),
            "due_unit_count": palace.get("due_unit_count"),
            "next_review_date": palace.get("next_review_date"),
            "review_status": palace.get("review_status"),
            "mark_required": palace.get("mark_required"),
        },
    }


def undo_content_schedule_batch(
    session: Session,
    batch_id: str,
    *,
    palace_id: int | None = None,
    operation_id: str | None = None,
) -> dict[str, Any]:
    """Restore stage/due/has_passed from a content-reconcile demotion batch.

    Does not roll back content_hash or membership. Bumps unit revision and
    invalidates active review sessions for the palace.
    """
    batch = session.get(ReviewUnitScheduleBatch, str(batch_id or "").strip())
    if batch is None:
        raise ValueError(f"schedule batch not found: {batch_id}")
    if palace_id is not None and int(batch.palace_id) != int(palace_id):
        raise ValueError("schedule batch does not belong to this palace")
    if batch.undone_at is not None:
        raise ValueError("schedule batch already undone")
    try:
        entries = json.loads(batch.entries_json or "[]")
    except (TypeError, ValueError) as exc:
        raise ValueError("schedule batch entries are corrupt") from exc
    if not isinstance(entries, list):
        raise ValueError("schedule batch entries are corrupt")

    restored: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        unit_id = str(entry.get("unit_id") or "").strip()
        before = entry.get("before")
        if not unit_id or not isinstance(before, dict):
            continue
        row = session.get(ReviewUnitState, unit_id)
        if row is None or row.palace_id != batch.palace_id:
            continue
        row.stage_index = clamp_stage(int(before.get("stage_index") or 0))
        row.due_date = _parse_due_date(before.get("due_date"))
        row.has_passed = bool(before.get("has_passed"))
        row.revision += 1
        restored.append(
            {
                "unit_id": row.id,
                "anchor_uid": row.anchor_uid,
                "after": _schedule_snapshot_from_row(row),
            }
        )

    batch.undone_at = utc_now_naive()
    invalidated = _invalidate_active_sessions(session, batch.palace_id) if restored else 0
    session.flush()
    op_id = str(operation_id or "").strip() or None
    return {
        "batch_id": batch.id,
        "undo_token": batch.id,
        "palace_id": batch.palace_id,
        "operation_id": op_id,
        "restored_count": len(restored),
        "restored": restored,
        "invalidated_session_count": invalidated,
    }


def reconcile_palace_units(session: Session, palace_id: int) -> dict[str, Any]:
    tree, definitions = resolve_unit_definitions(session, palace_id)
    today = date.today()
    old_states = _active_states(session, palace_id)
    old_by_anchor = {row.anchor_uid: row for row in old_states}
    old_members = {row.id: set(json_load_list(row.node_uids_json)) for row in old_states}
    changes: list[dict[str, Any]] = []
    demotion_entries: list[dict[str, Any]] = []

    if not definitions:
        for row in old_states:
            before = _schedule_snapshot_from_row(row)
            row.active = False
            row.revision += 1
            changes.append(
                _change_entry(
                    unit_id=row.id,
                    anchor_uid=row.anchor_uid,
                    title="",
                    action="deactivated",
                    before=before,
                    after=_schedule_snapshot_from_row(row),
                )
            )
        invalidated = _invalidate_active_sessions(session, palace_id) if old_states else 0
        session.flush()
        return {
            "palace_id": palace_id,
            "mark_required": True,
            "unit_count": 0,
            "changed": bool(old_states),
            "invalidated_session_count": invalidated,
            "changes": changes,
            "undo_token": None,
            "schedule_batch_id": None,
        }

    used_ids: set[str] = set()
    changed = False
    for definition in definitions:
        members = set(definition.node_uids)
        overlapping = [row for row in old_states if old_members[row.id] & members]
        current = old_by_anchor.get(definition.anchor_uid)
        sources = overlapping or ([current] if current is not None else [])
        inherited_stage = min((row.stage_index for row in sources), default=0)
        inherited_due = min((row.due_date for row in sources), default=today)
        inherited_passed = bool(sources) and all(row.has_passed for row in sources)

        if current is None:
            current = ReviewUnitState(
                id=uuid.uuid4().hex,
                palace_id=palace_id,
                anchor_uid=definition.anchor_uid,
                unit_kind=definition.unit_kind,
                node_uids_json=json.dumps(definition.node_uids, ensure_ascii=False),
                membership_hash=definition.membership_hash,
                content_hash=definition.content_hash,
                revision=1,
                stage_index=inherited_stage,
                has_passed=inherited_passed,
                due_date=inherited_due,
                active=True,
            )
            session.add(current)
            changed = True
            after = _schedule_snapshot_from_row(current)
            changes.append(
                _change_entry(
                    unit_id=current.id,
                    anchor_uid=current.anchor_uid,
                    title=definition.title,
                    action="created",
                    before=None,
                    after=after,
                )
            )
        else:
            membership_changed = current.membership_hash != definition.membership_hash
            content_changed = current.content_hash != definition.content_hash
            before = _schedule_snapshot_from_row(current)
            action: str | None = None
            if membership_changed or content_changed:
                current.revision += 1
                changed = True
            if membership_changed:
                current.stage_index = inherited_stage
                current.has_passed = inherited_passed
                current.due_date = inherited_due
                action = "membership_updated"
            elif content_changed:
                current.stage_index = max(0, current.stage_index - 1)
                current.due_date = today
                action = "content_demoted"
            current.unit_kind = definition.unit_kind
            current.node_uids_json = json.dumps(definition.node_uids, ensure_ascii=False)
            current.membership_hash = definition.membership_hash
            current.content_hash = definition.content_hash
            current.active = True
            if action is not None:
                after = _schedule_snapshot_from_row(current)
                entry = _change_entry(
                    unit_id=current.id,
                    anchor_uid=current.anchor_uid,
                    title=definition.title,
                    action=action,
                    before=before,
                    after=after,
                )
                changes.append(entry)
                if action == "content_demoted":
                    demotion_entries.append(entry)
        used_ids.add(current.id)

    for row in old_states:
        if row.id not in used_ids:
            before = _schedule_snapshot_from_row(row)
            row.active = False
            row.revision += 1
            changed = True
            changes.append(
                _change_entry(
                    unit_id=row.id,
                    anchor_uid=row.anchor_uid,
                    title="",
                    action="deactivated",
                    before=before,
                    after=_schedule_snapshot_from_row(row),
                )
            )

    undo_token: str | None = None
    if demotion_entries:
        undo_token = uuid.uuid4().hex
        session.add(
            ReviewUnitScheduleBatch(
                id=undo_token,
                palace_id=palace_id,
                reason="content_reconcile",
                entries_json=json.dumps(demotion_entries, ensure_ascii=False),
            )
        )

    invalidated = _invalidate_active_sessions(session, palace_id) if changed else 0
    session.flush()
    return {
        "palace_id": palace_id,
        "mark_required": False,
        "unit_count": len(definitions),
        "changed": changed,
        "invalidated_session_count": invalidated,
        "title": tree.get("title") or "",
        "changes": changes,
        "undo_token": undo_token,
        "schedule_batch_id": undo_token,
    }


def unit_payload(
    row: ReviewUnitState,
    definition: UnitDefinition | None = None,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "palace_id": row.palace_id,
        "anchor_uid": row.anchor_uid,
        "unit_kind": row.unit_kind,
        "title": definition.title if definition is not None else "",
        "node_uids": (
            list(definition.node_uids)
            if definition is not None
            else json_load_list(row.node_uids_json)
        ),
        "revision": row.revision,
        "stage_index": row.stage_index,
        "interval_days": INTERVAL_DAYS[row.stage_index],
        "has_passed": row.has_passed,
        "due_date": row.due_date.isoformat(),
        "due": row.due_date <= date.today(),
        "active": row.active,
    }


def _unit_hashes_lag(
    states: list[ReviewUnitState],
    definitions: list[UnitDefinition],
) -> bool:
    """True when stored unit hashes disagree with live editor_doc definitions.

    Covers mid-edit process kill: editor_doc advanced without leave reconcile, so
    ReviewUnitState membership/content hashes (and schedule) lag the live tree.
    """
    by_anchor = {item.anchor_uid: item for item in definitions}
    if {row.anchor_uid for row in states} != set(by_anchor):
        return True
    for row in states:
        definition = by_anchor.get(row.anchor_uid)
        if definition is None:
            return True
        if (
            row.membership_hash != definition.membership_hash
            or row.content_hash != definition.content_hash
        ):
            return True
    return False


def _reconcile_if_unit_hashes_lag(session: Session, palace_id: int) -> bool:
    """Flush-only reconcile when hashes lag. Does not commit (caller owns txn)."""
    try:
        _tree, definitions = resolve_unit_definitions(session, palace_id)
    except ValueError:
        return False
    states = _active_states(session, palace_id)
    if not _unit_hashes_lag(states, definitions):
        return False
    reconcile_palace_units(session, palace_id)
    return True


def get_palace_unit_projection(session: Session, palace_id: int) -> dict[str, Any]:
    tree, definitions = resolve_unit_definitions(session, palace_id)
    states = _active_states(session, palace_id)
    if _unit_hashes_lag(states, definitions):
        # Catch mid-edit kill before freestyle / session start projects due units.
        reconcile_palace_units(session, palace_id)
        tree, definitions = resolve_unit_definitions(session, palace_id)
        states = _active_states(session, palace_id)
    definition_by_anchor = {item.anchor_uid: item for item in definitions}
    due = [row for row in states if row.due_date <= date.today()]
    next_due = min((row.due_date for row in states), default=None)
    return {
        "palace_id": palace_id,
        "title": tree.get("title") or "",
        "mark_required": not definitions,
        "permanent_mark_count": sum(
            1
            for node in (tree.get("nodes") or {}).values()
            if node.get("permanent_split_mark")
        ),
        "unit_count": len(states),
        "due_unit_count": len(due),
        "next_review_date": next_due.isoformat() if next_due else None,
        "review_status": (
            "marking_required" if not definitions else ("due" if due else "scheduled")
        ),
        "units": [
            unit_payload(row, definition_by_anchor.get(row.anchor_uid)) for row in states
        ],
    }


def _query_due_unit_rows(
    session: Session,
    palace_id: int | None = None,
) -> list[ReviewUnitState]:
    query = session.query(ReviewUnitState).filter(
        ReviewUnitState.active.is_(True),
        ReviewUnitState.due_date <= date.today(),
    )
    if palace_id is not None:
        query = query.filter(ReviewUnitState.palace_id == palace_id)
    return query.order_by(
        ReviewUnitState.due_date.asc(),
        ReviewUnitState.palace_id.asc(),
    ).all()


def list_due_units(session: Session, palace_id: int | None = None) -> list[dict[str, Any]]:
    rows = _query_due_unit_rows(session, palace_id)
    candidate_palace_ids = sorted({row.palace_id for row in rows})
    if not candidate_palace_ids:
        return []

    # Only palaces that appear in the due candidate set — not every palace in the DB.
    # Load the candidate topology and active states in batches so the normal queue
    # path stays flat; only genuinely stale palaces need per-palace reconciliation.
    palaces = (
        session.query(Palace)
        .filter(
            Palace.id.in_(candidate_palace_ids),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .all()
    )
    if not palaces:
        return []
    palace_by_id = {palace.id: palace for palace in palaces}
    active_states = (
        session.query(ReviewUnitState)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.palace_id.in_(list(palace_by_id)),
        )
        .all()
    )
    states_by_palace: dict[int, list[ReviewUnitState]] = {}
    for state in active_states:
        states_by_palace.setdefault(state.palace_id, []).append(state)

    stale_palace_ids: list[int] = []
    for palace in palaces:
        _tree, definitions = _definitions_for_palace(palace)
        if _unit_hashes_lag(states_by_palace.get(palace.id, []), definitions):
            stale_palace_ids.append(palace.id)

    reconciled_any = False
    for pid in stale_palace_ids:
        reconcile_palace_units(session, pid)
        reconciled_any = True

    if reconciled_any:
        # Demotion can move due_date; membership change can alter the active set.
        rows = _query_due_unit_rows(session, palace_id)
        candidate_palace_ids = sorted({row.palace_id for row in rows})
        if not candidate_palace_ids:
            return []
        palaces = (
            session.query(Palace)
            .filter(
                Palace.id.in_(candidate_palace_ids),
                Palace.deleted_at.is_(None),
                Palace.archived.is_(False),
            )
            .all()
        )
        if not palaces:
            return []
        palace_by_id = {palace.id: palace for palace in palaces}

    definitions_by_palace = {
        palace.id: {
            item.anchor_uid: item for item in _definitions_for_palace(palace)[1]
        }
        for palace in palaces
    }
    result: list[dict[str, Any]] = []
    for row in rows:
        definition = definitions_by_palace.get(row.palace_id, {}).get(row.anchor_uid)
        if definition is None:
            continue
        if (
            definition.membership_hash != row.membership_hash
            or definition.content_hash != row.content_hash
        ):
            # Should be rare after lag reconcile; skip rather than project stale topology.
            continue
        payload = unit_payload(row, definition)
        palace_row = palace_by_id.get(row.palace_id)
        payload["palace_title"] = palace_row.title if palace_row is not None else ""
        result.append(payload)
    return result


__all__ = [
    "UnitDefinition",
    "adjust_unit_schedule",
    "get_palace_unit_projection",
    "json_load_list",
    "list_due_units",
    "reconcile_palace_units",
    "resolve_unit_definitions",
    "undo_content_schedule_batch",
    "unit_payload",
]
