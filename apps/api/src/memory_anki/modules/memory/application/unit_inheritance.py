"""Carry-over of earned review progress across permanent-mark changes.

A permanent-mark edit must never restart a unit at first-learning. Deleting the
final mark only flips ``ReviewUnitState.active`` -- the earned ``stage_index``,
``has_passed`` and ``due_date`` stay on disk -- so inheritance has to look past
the active set to find the evidence a restored mark deserves.

This module is framework-free apart from the SQLAlchemy row type it reads; all
decisions live in small pure helpers so the reconcile loop stays readable.
"""

from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState


def _json_load_list(raw: str | None) -> list[str]:
    """Local copy of the projection helper, kept here to avoid an import cycle."""
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in value] if isinstance(value, list) else []


def _members(row: ReviewUnitState) -> set[str]:
    return set(_json_load_list(row.node_uids_json))


def inheritance_candidates(session: Session, palace_id: int) -> list[ReviewUnitState]:
    """Every unit row for a palace, active or not, as inheritance candidates.

    Deleting the final permanent mark deactivates every row while leaving its
    earned stage/due intact. Re-marking used to read only active rows, find no
    overlap, and restart the unit at first-learning -- silently discarding a
    ladder position that was still stored. Inactive rows are legitimate evidence
    for "this region was already studied", so they belong in the candidate set.

    Ordered oldest-first: when several incarnations exist, the newest one is the
    most recent expression of the learner's progress and wins.
    """
    return (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.palace_id == palace_id)
        .order_by(ReviewUnitState.updated_at.asc(), ReviewUnitState.id.asc())
        .all()
    )


def region_is_live(candidates: list[ReviewUnitState], members: set[str]) -> bool:
    """True when any *live* unit already covers part of this region.

    Judged against the revision-time active set, never the set the reconcile
    loop is mutating: reactivating an earlier unit would otherwise make a later
    sibling look "still live" and mint a duplicate row instead of restoring its
    own.
    """
    return any(row.active and _members(row) & members for row in candidates)


def overlapping_sources(
    candidates: list[ReviewUnitState],
    members: set[str],
) -> list[ReviewUnitState]:
    """Units whose stored membership intersects ``members``.

    Identity is deliberately membership-based, not ``(anchor_uid, unit_kind)``:
    moving a mark one level down (A -> A1) is the same studied region under a new
    anchor, and the learner's ladder position should follow the content. Rows
    with no node overlap are unrelated work and never contribute.

    Inactive rows are considered only where the region has no live owner. A row
    that was deactivated because its region moved on -- a superseded cohort, a
    split-off remainder -- still holds the *old* schedule, and letting it vote
    would drag a healthy unit down to a stale stage.
    """
    overlapping = [row for row in candidates if _members(row) & members]
    active = [row for row in overlapping if row.active]
    return active or overlapping


def same_identity_sources(
    candidates: list[ReviewUnitState],
    anchor_uid: str,
    unit_kind: str,
) -> list[ReviewUnitState]:
    """Prior incarnations of one active identity, oldest first."""
    return [
        row
        for row in candidates
        if (str(row.anchor_uid), str(row.unit_kind)) == (str(anchor_uid), str(unit_kind))
    ]


def inheritance_vote(
    sources: list[ReviewUnitState],
    *,
    default_stage: int,
    default_due: date,
) -> tuple[int, date, bool]:
    """Lowest stage / earliest due among ``sources``, else the defaults.

    Lowest-with-earliest is the conservative merge rule: a region inherits the
    weakest of its contributing units so no part of it silently skips work.
    ``has_passed`` requires every source to have passed.
    """
    if not sources:
        return default_stage, default_due, False
    return (
        min(row.stage_index for row in sources),
        min(row.due_date for row in sources),
        all(row.has_passed for row in sources),
    )


def find_resurrectable(
    candidates: list[ReviewUnitState],
    *,
    anchor_uid: str,
    unit_kind: str,
    region_is_live: bool,
) -> ReviewUnitState | None:
    """The prior row to reactivate for a re-added mark, if any.

    Returns ``None`` whenever the region still has a live owner: that shape is an
    ordinary split/merge, where a fresh row should carry the new topology rather
    than impersonating a retired one. Only a region nothing active covers --
    every mark deleted, then re-added -- restores its previous incarnation, so
    unit id, rating history, and the earned ladder position stay attached to the
    same record. The newest incarnation wins.
    """
    if region_is_live:
        return None
    same_identity = same_identity_sources(candidates, anchor_uid, unit_kind)
    return same_identity[-1] if same_identity else None


__all__ = [
    "find_resurrectable",
    "inheritance_candidates",
    "inheritance_vote",
    "overlapping_sources",
    "region_is_live",
    "same_identity_sources",
]
