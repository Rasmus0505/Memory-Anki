"""One-time backfill for the unit scheduling policy.

The schema migrations only add nullable columns. This module:

- replays the effective ledger of a unit that has no FSRS checkpoint, and
- infers the fixed early-ladder counter for every other unit from its booked
  gap, without moving the due date the learner was promised.

It is idempotent: units already carrying the current scheduler version are
skipped, so a crash mid-run simply resumes on the next startup.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import study_day_of
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from .unit_fsrs_adapter import (
    ANCHOR_GRADUATED_STEP,
    SCHEDULER_VERSION,
    infer_early_step,
    migrate_legacy_early_step,
    replay_history,
)

MARKER_KEY = "review_fsrs_backfill"
_SAMPLE_LIMIT = 20


def _record_change(
    stats: _Stats,
    samples: list[dict[str, Any]],
    unit: ReviewUnitState,
    new_due: date,
) -> None:
    old_due = unit.due_date
    if old_due == new_due:
        stats.same += 1
        return
    stats.changed_due += 1
    if new_due < old_due:
        stats.earlier += 1
    else:
        stats.later += 1
    if len(samples) < _SAMPLE_LIMIT:
        samples.append(
            {
                "unit_id": unit.id,
                "old_due": old_due.isoformat(),
                "new_due": new_due.isoformat(),
                "delta_days": (new_due - old_due).days,
            }
        )


@dataclass
class _Stats:
    units: int = 0
    with_history: int = 0
    empty: int = 0
    changed_due: int = 0
    earlier: int = 0
    same: int = 0
    later: int = 0
    skipped_already_current: int = 0
    stamped_early: int = 0
    kept_mature: int = 0
    operations: int = 0
    skipped_operations: int = 0


def backfill_fsrs_scheduler(
    session: Session,
    *,
    backup: Callable[[str], Any] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Bring ``review_unit_states`` onto the current scheduling policy.

    Two different jobs share this one-time pass:

    - A unit with no FSRS checkpoint is seeded by replaying its effective
      ledger (the original switch).
    - A unit that already carries a card gets the fixed-ladder counter inferred
      from its booked gap. Its due date is **not** moved: the learner keeps the
      booking they were promised, and the new ladder governs the next rating.
      A mature unit is stamped with the finished marker.

    The first write takes a rescue backup. ``backup`` is invoked once before the
    first write; the caller owns the transaction and the backup implementation,
    keeping this application module free of a dependency on the backups module.
    """
    stats = _Stats()
    samples: list[dict[str, Any]] = []
    units = (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.active.is_(True))
        .order_by(ReviewUnitState.id.asc())
        .all()
    )
    marker = session.query(Config).filter(Config.key == MARKER_KEY).one_or_none()
    already_marked = marker is not None and str(marker.value or "") == SCHEDULER_VERSION
    wrote = False

    for unit in units:
        stats.units += 1
        if already_marked and unit.fsrs_scheduler_version == SCHEDULER_VERSION:
            stats.skipped_already_current += 1
            continue
        operations = _effective_operations(session, unit.id)
        if not operations:
            stats.empty += 1
            continue
        if unit.fsrs_last_review is not None:
            booked_gap = max(0, (unit.due_date - study_day_of(unit.fsrs_last_review)).days)
            # The booked gap was recorded under the retired four-step ladder, so
            # it is inferred with that ladder's table and then mapped onto the
            # current two-checkpoint anchor. Any completed day-level fixed
            # review has passed the overnight check and belongs to FSRS.
            inferred = migrate_legacy_early_step(
                infer_early_step(booked_gap_days=booked_gap)
            )
            stats.stamped_early += 1
            if inferred is not None and inferred >= ANCHOR_GRADUATED_STEP:
                stats.kept_mature += 1
            if dry_run:
                continue
            if not wrote and backup is not None:
                backup("pre-fsrs-switch")
            wrote = True
            unit.early_step = inferred
            unit.fsrs_scheduler_version = SCHEDULER_VERSION
            continue
        stats.with_history += 1
        replay = replay_history(operations, unit_id=unit.id)
        stats.operations += replay.operations
        stats.skipped_operations += replay.skipped
        if replay.due_date is None:
            continue
        new_due = replay.due_date
        _record_change(stats, samples, unit, new_due)
        if dry_run:
            continue
        if not wrote and backup is not None:
            backup("pre-fsrs-switch")
        wrote = True
        unit.fsrs_stability = replay.state.stability
        unit.fsrs_difficulty = replay.state.difficulty
        unit.fsrs_state = replay.state.fsrs_state
        unit.fsrs_step = replay.state.step
        unit.fsrs_due_at = replay.state.due_at
        unit.fsrs_last_review = replay.state.last_review
        unit.fsrs_scheduler_version = SCHEDULER_VERSION
        unit.stage_index = replay.stage_index
        unit.has_passed = replay.has_passed
        unit.early_step = replay.early_step
        unit.due_date = new_due

    if not dry_run:
        if marker is None:
            marker = Config(key=MARKER_KEY, value=SCHEDULER_VERSION)
            session.add(marker)
        else:
            marker.value = SCHEDULER_VERSION
    return {
        "scheduler_version": SCHEDULER_VERSION,
        "dry_run": dry_run,
        "already_marked": already_marked,
        "units": stats.units,
        "with_history": stats.with_history,
        "empty": stats.empty,
        "changed_due": stats.changed_due,
        "earlier": stats.earlier,
        "same": stats.same,
        "later": stats.later,
        "skipped_already_current": stats.skipped_already_current,
        "stamped_early": stats.stamped_early,
        "kept_mature": stats.kept_mature,
        "operations": stats.operations,
        "skipped_operations": stats.skipped_operations,
        "earliest_due": _min_due(units),
        "samples": samples,
    }


def _effective_operations(session: Session, unit_id: str) -> list[ReviewUnitRatingOperation]:
    return (
        session.query(ReviewUnitRatingOperation)
        .filter(
            ReviewUnitRatingOperation.unit_id == unit_id,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .order_by(
            ReviewUnitRatingOperation.created_at.asc(),
            ReviewUnitRatingOperation.id.asc(),
        )
        .all()
    )


def _min_due(units: list[ReviewUnitState]) -> date | None:
    return min((unit.due_date for unit in units), default=None)


__all__ = ["MARKER_KEY", "backfill_fsrs_scheduler"]
