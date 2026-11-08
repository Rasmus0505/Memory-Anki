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
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import study_day_of
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from .unit_scheduler import INTERVAL_DAYS, assert_schedulable_due, clamp_stage


@dataclass(frozen=True)
class InheritanceSource:
    """Entry-time evidence: reconciliation must not vote on its own mutations."""

    id: str
    anchor_uid: str
    unit_kind: str
    node_uids: frozenset[str]
    active: bool
    stage_index: int
    due_date: date
    has_passed: bool
    last_passed_at: datetime | None
    # Fixed early-ladder position. Carried with the schedule so a split or a
    # restored mark does not replay a review the learner already did.
    early_step: int | None = None
    # Any FSRS checkpoint at all. A row that was rated (even 忘记) has one; a
    # row that only exists because a mark was drawn does not.
    fsrs_last_review: datetime | None = None
    # The full memory checkpoint travels with a merge. ``stage_index`` is only
    # a display bucket of the booked due date, so a unit pulled forward (due
    # today, stage 0) still remembers how well it was known; copying the bucket
    # without this state would restart it at first learning.
    fsrs_stability: float | None = None
    fsrs_difficulty: float | None = None
    fsrs_state: int | None = None
    fsrs_step: int | None = None
    fsrs_due_at: datetime | None = None
    fsrs_scheduler_version: str | None = None
    lapse_original_interval_days: int | None = None
    lapse_started_on: date | None = None

    @classmethod
    def from_row(cls, row: ReviewUnitState) -> InheritanceSource:
        return cls(
            id=row.id, anchor_uid=row.anchor_uid, unit_kind=row.unit_kind,
            node_uids=frozenset(_json_load_list(row.node_uids_json)), active=row.active,
            stage_index=row.stage_index, due_date=row.due_date,
            has_passed=row.has_passed, last_passed_at=row.last_passed_at,
            early_step=row.early_step, fsrs_last_review=row.fsrs_last_review,
            fsrs_stability=row.fsrs_stability,
            fsrs_difficulty=row.fsrs_difficulty,
            fsrs_state=row.fsrs_state,
            fsrs_step=row.fsrs_step,
            fsrs_due_at=row.fsrs_due_at,
            fsrs_scheduler_version=row.fsrs_scheduler_version,
            lapse_original_interval_days=row.lapse_original_interval_days,
            lapse_started_on=row.lapse_started_on,
        )


def _json_load_list(raw: str | None) -> list[str]:
    """Corrupt membership is not evidence of a genuinely unstudied region."""
    if not raw:
        raise ValueError("review unit membership is missing")
    value = json.loads(raw)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("review unit membership must be a list of node UIDs")
    return value


def _members(row: InheritanceSource) -> frozenset[str]:
    return row.node_uids


def inheritance_candidates(session: Session, palace_id: int) -> list[InheritanceSource]:
    """Every unit row for a palace, active or not, as inheritance candidates.

    Deleting the final permanent mark deactivates every row while leaving its
    earned stage/due intact. Re-marking used to read only active rows, find no
    overlap, and restart the unit at first-learning -- silently discarding a
    ladder position that was still stored. Inactive rows are legitimate evidence
    for "this region was already studied", so they belong in the candidate set.

    Ordered oldest-first: when several incarnations exist, the newest one is the
    most recent expression of the learner's progress and wins.
    """
    rows = (
        session.query(ReviewUnitState)
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitState.permanently_removed.is_(False),
        )
        .order_by(ReviewUnitState.updated_at.asc(), ReviewUnitState.id.asc())
        .all()
    )
    return [InheritanceSource.from_row(row) for row in rows]


def region_is_live(candidates: list[InheritanceSource], members: set[str]) -> bool:
    """True when any *live* unit already covers part of this region.

    Judged against the revision-time active set, never the set the reconcile
    loop is mutating: reactivating an earlier unit would otherwise make a later
    sibling look "still live" and mint a duplicate row instead of restoring its
    own.
    """
    return any(row.active and _members(row) & members for row in candidates)


def overlapping_sources(
    candidates: list[InheritanceSource],
    members: set[str],
) -> list[InheritanceSource]:
    """Units whose stored membership intersects ``members``.

    Identity is deliberately membership-based, not ``(anchor_uid, unit_kind)``:
    moving a mark one level down (A -> A1) is the same studied region under a new
    anchor, and the learner's ladder position should follow the content. Rows
    with no node overlap are unrelated work and never contribute.

    Inactive rows are considered only where the region has no live owner. A row
    that was deactivated because its region moved on -- a split-off remainder, a
    merged-away unit -- still holds the *old* schedule, and letting it vote
    would drag a healthy unit down to a stale stage.
    """
    selected: dict[str, InheritanceSource] = {}
    for uid in sorted(members):
        overlapping = [row for row in candidates if uid in _members(row)]
        active = [row for row in overlapping if row.active]
        for row in active or overlapping:
            selected[row.id] = row
    return list(selected.values())


def sources_for_members(
    candidates: list[InheritanceSource],
    members: set[str],
    nodes: dict[str, Any],
) -> list[InheritanceSource]:
    """Existing content follows its region; new content follows its closest branch.

    Walk through newly inserted ancestors until stored branch evidence exists.
    Never borrow a sibling's schedule merely because it shares an ancestor.
    Legacy ``cohort`` rows (retired by migration 0071) never speak for a region:
    they were sibling-level assessments, not a branch schedule.
    """
    branches = [row for row in candidates if row.unit_kind != "cohort"]
    selected = {row.id: row for row in overlapping_sources(branches, members)}
    known_members = set().union(*(_members(row) for row in candidates))
    for uid in sorted(members - known_members):
        parent = nodes[uid].get("parent_uid")
        visited = {uid}
        while parent is not None:
            if parent in visited:
                raise ValueError("cycle in review unit ancestor chain")
            visited.add(parent)
            owners = [
                row for row in branches
                if parent in _members(row) or parent == row.anchor_uid
            ]
            active = [row for row in owners if row.active]
            if owners:
                for row in active or owners:
                    selected[row.id] = row
                break
            parent = nodes[parent].get("parent_uid")
    return list(selected.values())


def same_identity_sources(
    candidates: list[InheritanceSource],
    anchor_uid: str,
    unit_kind: str,
) -> list[InheritanceSource]:
    """Prior incarnations of one active identity, oldest first."""
    return [
        row
        for row in candidates
        if (str(row.anchor_uid), str(row.unit_kind)) == (str(anchor_uid), str(unit_kind))
    ]


def has_learning_evidence(row: Any) -> bool:
    """True when the learner has actually rated this unit at some point.

    A row exists as soon as a permanent mark is drawn, so existence is not
    evidence: an untouched row sits at stage 0, due today, with no pass and no
    FSRS checkpoint. Letting such a row vote in a merge lets one never-studied
    remainder pull a studied palace back to 首学 (reported on a whole-palace
    mark). Rows that were rated and failed still count — they carry an FSRS
    checkpoint and must keep pulling the merged unit earlier.
    """
    return bool(
        getattr(row, "has_passed", False)
        or getattr(row, "last_passed_at", None) is not None
        or getattr(row, "fsrs_last_review", None) is not None
        or getattr(row, "early_step", None) is not None
        or int(getattr(row, "stage_index", 0) or 0) > 0
    )


def evidence_sources(sources: Sequence[Any]) -> list[Any]:
    """Rows allowed to vote on the merged schedule.

    Never-studied rows abstain. When nothing has been studied every row is
    returned, so an all-new merge still lands at first learning.
    """
    evidence = [row for row in sources if has_learning_evidence(row)]
    return evidence or list(sources)


def inheritance_vote(
    sources: list[InheritanceSource],
    *,
    default_stage: int,
    default_due: date,
) -> tuple[int, date, bool]:
    """Lowest stage / earliest due among ``sources``, else the defaults.

    Lowest-with-earliest is the conservative merge rule: a region inherits the
    weakest of its contributing units so no part of it silently skips work.
    ``has_passed`` requires every voting source to have passed.

    Never-studied rows do not vote on the level (they have earned nothing and
    would otherwise reset the merge to 首学), but their due date still counts:
    new content in the merged unit should still be seen when it falls due.
    """
    if not sources:
        return default_stage, default_due, False
    # Bad evidence must fail before writes, never silently rebook studied content.
    for row in sources:
        assert_schedulable_due(row.due_date, today=default_due)
    voters = evidence_sources(sources)
    return (
        min(int(row.stage_index) for row in voters),
        min(row.due_date for row in sources),
        all(bool(row.has_passed) for row in voters),
    )


def has_fsrs_checkpoint(row: Any) -> bool:
    """True when the row holds an actual FSRS memory state, not just a bucket."""
    return bool(
        getattr(row, "fsrs_stability", None) is not None
        or getattr(row, "fsrs_last_review", None) is not None
    )


def _booked_interval_days(row: InheritanceSource) -> int:
    """The gap the row was actually booked at, regardless of its display bucket."""
    if row.fsrs_last_review is not None:
        return max(0, (row.due_date - study_day_of(row.fsrs_last_review)).days)
    if row.stage_index > 0:
        return INTERVAL_DAYS[clamp_stage(row.stage_index)]
    return 0


def inheritance_memory_source(
    sources: Sequence[InheritanceSource],
    candidates: Sequence[InheritanceSource],
    members: set[str],
) -> InheritanceSource | None:
    """The contributing unit whose FSRS checkpoint a merged unit should carry.

    ``inheritance_vote`` only moves the level/due/pass projection, and
    ``stage_index`` is a display bucket of the booked due date: a unit pulled
    forward to today reads as stage 0 even though it was learned for weeks. If a
    merge copied only that bucket, the merged unit would look brand new on its
    next rating. The memory checkpoint is real evidence, so it is carried over
    here.

    The current owners (``sources``) speak first; when none of them has a
    checkpoint -- e.g. an overlay unit created while the studied marks were
    temporarily off -- the region's own prior incarnations are consulted. The
    weakest checkpoint wins, matching the conservative merge rule.
    """
    region = set(members)
    pools = (
        list(sources),
        [row for row in candidates if _members(row) & region],
    )
    for pool in pools:
        checkpointed = [row for row in evidence_sources(pool) if has_fsrs_checkpoint(row)]
        if checkpointed:
            return min(
                checkpointed,
                key=lambda row: (_booked_interval_days(row), row.due_date, row.id),
            )
    return None


def inherited_early_step(sources: list[InheritanceSource]) -> int | None:
    """The fixed-ladder counter of the weakest contributing unit.

    ``inheritance_vote`` already chooses the lowest stage / earliest due; the
    counter must follow that same unit, or a merged region would keep a stronger
    position than its schedule says. ``None`` means "let the scheduler infer it".
    """
    if not sources:
        return None
    weakest = min(
        evidence_sources(sources),
        key=lambda row: (int(row.stage_index), row.due_date),
    )
    return weakest.early_step


def find_resurrectable(
    candidates: list[InheritanceSource],
    *,
    anchor_uid: str,
    unit_kind: str,
    region_is_live: bool,
) -> InheritanceSource | None:
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
    "evidence_sources",
    "find_resurrectable",
    "has_fsrs_checkpoint",
    "has_learning_evidence",
    "inheritance_candidates",
    "inheritance_memory_source",
    "inheritance_vote",
    "inherited_early_step",
    "overlapping_sources",
    "region_is_live",
    "same_identity_sources",
]
