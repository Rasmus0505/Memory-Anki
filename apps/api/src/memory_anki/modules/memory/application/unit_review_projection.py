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
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.mindmap_document.api import (
    build_document_tree,
    permanent_mark_uids_from_nodes,
    split_scheduling_units,
)

from .unit_scheduler import INTERVAL_DAYS


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


def resolve_unit_definitions(
    session: Session,
    palace_id: int,
) -> tuple[dict[str, Any], list[UnitDefinition]]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None or palace.archived:
        raise ValueError(f"palace not found: {palace_id}")
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
    return len(rows)


def reconcile_palace_units(session: Session, palace_id: int) -> dict[str, Any]:
    tree, definitions = resolve_unit_definitions(session, palace_id)
    today = date.today()
    old_states = _active_states(session, palace_id)
    old_by_anchor = {row.anchor_uid: row for row in old_states}
    old_members = {row.id: set(json_load_list(row.node_uids_json)) for row in old_states}

    if not definitions:
        for row in old_states:
            row.active = False
            row.revision += 1
        invalidated = _invalidate_active_sessions(session, palace_id) if old_states else 0
        session.flush()
        return {
            "palace_id": palace_id,
            "mark_required": True,
            "unit_count": 0,
            "changed": bool(old_states),
            "invalidated_session_count": invalidated,
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
        else:
            membership_changed = current.membership_hash != definition.membership_hash
            content_changed = current.content_hash != definition.content_hash
            if membership_changed or content_changed:
                current.revision += 1
                changed = True
            if membership_changed:
                current.stage_index = inherited_stage
                current.has_passed = inherited_passed
                current.due_date = inherited_due
            elif content_changed:
                current.stage_index = max(0, current.stage_index - 1)
                current.due_date = today
            current.unit_kind = definition.unit_kind
            current.node_uids_json = json.dumps(definition.node_uids, ensure_ascii=False)
            current.membership_hash = definition.membership_hash
            current.content_hash = definition.content_hash
            current.active = True
        used_ids.add(current.id)

    for row in old_states:
        if row.id not in used_ids:
            row.active = False
            row.revision += 1
            changed = True

    invalidated = _invalidate_active_sessions(session, palace_id) if changed else 0
    session.flush()
    return {
        "palace_id": palace_id,
        "mark_required": False,
        "unit_count": len(definitions),
        "changed": changed,
        "invalidated_session_count": invalidated,
        "title": tree.get("title") or "",
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


def get_palace_unit_projection(session: Session, palace_id: int) -> dict[str, Any]:
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


def list_due_units(session: Session, palace_id: int | None = None) -> list[dict[str, Any]]:
    query = session.query(ReviewUnitState).filter(
        ReviewUnitState.active.is_(True),
        ReviewUnitState.due_date <= date.today(),
    )
    if palace_id is not None:
        query = query.filter(ReviewUnitState.palace_id == palace_id)
    rows = query.order_by(
        ReviewUnitState.due_date.asc(),
        ReviewUnitState.palace_id.asc(),
    ).all()
    definitions_by_palace: dict[int, dict[str, UnitDefinition]] = {}
    result: list[dict[str, Any]] = []
    for row in rows:
        if row.palace_id not in definitions_by_palace:
            _, definitions = resolve_unit_definitions(session, row.palace_id)
            definitions_by_palace[row.palace_id] = {
                item.anchor_uid: item for item in definitions
            }
        definition = definitions_by_palace[row.palace_id].get(row.anchor_uid)
        if definition is not None and definition.membership_hash == row.membership_hash:
            result.append(unit_payload(row, definition))
    return result


__all__ = [
    "UnitDefinition",
    "get_palace_unit_projection",
    "json_load_list",
    "list_due_units",
    "reconcile_palace_units",
    "resolve_unit_definitions",
    "unit_payload",
]
