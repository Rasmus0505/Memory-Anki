"""Commit boundary for freestyle round writes, including lost-race recovery.

Why this is its own module
--------------------------
Every round write funnels through one commit, and that commit is where two
optimistic-concurrency mechanisms collide.

``FreestyleRoundState`` is mapped with SQLAlchemy's ``version_id_col`` on the
same ``version`` column the practice module uses for its own ``expected_version``
check. The ORM guard therefore fires *after* the module's check has already
passed, whenever another writer commits in between. That window is hit often on
a real round: the live-study heartbeat writes to this table every few seconds,
and a second device syncs through the same rows.

Left unhandled the ORM raise escaped as ``StaleDataError`` → HTTP 500. One day's
log held 68 of them across ``/actions``, ``/overlay-quiz/ensure``, ``/ratings``
and ``/review/units/.../sessions``.

A lost race is not an error — it means the caller's snapshot is stale, which is
exactly what a ``conflict: true`` payload already means everywhere else in this
module and what the frontend retries. So the loss is converted here, once, into
that payload instead of an exception. The ORM guard stays: it is the real
protection against a stale session clobbering a newer plan.

See docs/incidents/0003-round-stale-data-500.md.
"""

from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import (
    FreestyleRoundOperationReceipt,
    FreestyleRoundState,
)

from .round_read_lookups import lookup_operation_receipt


def remember_operation(
    session: Session, row: FreestyleRoundState, operation_id: str
) -> None:
    """Record the idempotency receipt. See ``round_read_lookups`` for the rule."""
    op_id = str(operation_id or "").strip()
    if not op_id:
        return
    existing = lookup_operation_receipt(session, op_id)
    if existing is None:
        session.add(
            FreestyleRoundOperationReceipt(
                operation_id=op_id,
                round_id=row.round_id,
                created_at=utc_now_naive(),
            )
        )
    elif existing.round_id != row.round_id:
        raise ValueError("operation_id belongs to another round")


def commit_operation(
    session: Session, row: FreestyleRoundState, operation_id: str
) -> bool:
    """Commit the staged round write. Returns False when a racing write won.

    On a loss the session is rolled back and the row refreshed, so the caller
    can hand `conflict=True` to ``_payload`` and report the winner's real
    version. The loser's staged changes are discarded, never merged over the
    newer plan — a stale client must not silently overwrite another device.
    """
    remember_operation(session, row, operation_id)
    try:
        session.commit()
        return True
    except StaleDataError:
        session.rollback()
        # After rollback the instance is expired, so this reloads the winner's
        # committed row: the caller's `_payload(row, conflict=True)` then reports
        # the real current version, which is what the client retries against.
        session.refresh(row)
        return False


__all__ = ["commit_operation", "remember_operation"]
