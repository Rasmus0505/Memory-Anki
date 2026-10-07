"""Reconcile live editor topology into stable review-unit rows.

Separated from the projection read model because reconcile is the write path: it
decides unit identity, membership, and which earned progress carries over a
permanent-mark change.

Imports stay one-way (projection -> reconcile) so the read model can heal a
lagging hash mid-request without a cycle. The helpers reconcile needs from the
projection's world are defined locally for that reason.
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitScheduleBatch,
    ReviewUnitState,
)

from .unit_inheritance import (
    find_resurrectable,
    inheritance_candidates,
    inheritance_vote,
    overlapping_sources,
    region_is_live,
)
from .unit_schedule_projection import _change_entry, _schedule_snapshot_from_row


def _active_unit_key(anchor_uid: str, unit_kind: str) -> tuple[str, str]:
    """Active units are unique per palace on this pair, not on the anchor alone.

    A parent node is both the anchor of its own isolation unit and the anchor of
    the cohort of its marked children.
    """
    return (str(anchor_uid), str(unit_kind))


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


def reconcile_palace_units(session: Session, palace_id: int) -> dict[str, Any]:
    from .unit_review_projection import resolve_unit_definitions

    tree, definitions = resolve_unit_definitions(session, palace_id)
    today = date.today()
    old_states = _active_states(session, palace_id)
    # Inheritance looks past the active set on purpose: an inactive row still
    # carries the ladder position earned before its mark was removed.
    candidates = inheritance_candidates(session, palace_id)
    old_by_key = {
        _active_unit_key(row.anchor_uid, row.unit_kind): row for row in old_states
    }
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
    # Snapshot the active set as it stood on entry. The loop below activates and
    # deactivates rows, and liveness questions must not be answered by units this
    # same reconcile just brought back.
    active_on_entry = list(old_states)
    for index, definition in enumerate(definitions):
        members = set(definition.node_uids)
        current = old_by_key.get(
            _active_unit_key(definition.anchor_uid, definition.unit_kind)
        )
        overlapping = overlapping_sources(candidates, members)
        # A region still covered by a live unit was never abandoned; only a
        # region with no live owner at all can be a resurrection.
        live_region = region_is_live(active_on_entry, members)
        sources = overlapping or ([current] if current is not None else [])
        inherited_stage, inherited_due, inherited_passed = inheritance_vote(
            sources, default_stage=0, default_due=today
        )

        if current is None:
            # No active unit owns this identity. Either the region is still
            # represented by other active units (a resized cohort, a split) and
            # the overlap vote above carried the schedule, or nothing active
            # covers it -- every mark was deleted and this one is added back --
            # in which case the deactivated row still holds the earned progress
            # and is reactivated instead of restarting at first-learning.
            resurrect = find_resurrectable(
                candidates,
                anchor_uid=definition.anchor_uid,
                unit_kind=definition.unit_kind,
                region_is_live=live_region,
            )
            if resurrect is not None:
                # Reactivate the existing row so unit_id, rating history, and
                # earned schedule stay attached to the same record.
                resurrect.active = True
                resurrect.revision += 1
                resurrect.stage_index = inherited_stage
                resurrect.has_passed = inherited_passed
                resurrect.due_date = inherited_due
                resurrect.node_uids_json = json.dumps(
                    definition.node_uids, ensure_ascii=False
                )
                resurrect.membership_hash = definition.membership_hash
                resurrect.content_hash = definition.content_hash
                resurrect.topology_order = index
                current = resurrect
                used_ids.add(current.id)
                changed = True
                changes.append(
                    _change_entry(
                        unit_id=current.id,
                        anchor_uid=current.anchor_uid,
                        title=definition.title,
                        action="reactivated",
                        before=None,
                        after=_schedule_snapshot_from_row(current),
                    )
                )
                continue
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
                topology_order=index,
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
            current.topology_order = index
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
