"""Read-only lookups used by the freestyle round service.

Why these live in their own module
----------------------------------
Every function here answers a question about **committed** state, and each is
called by a write path that has already staged changes. That combination is what
makes a plain ``session.query`` / ``session.get`` dangerous here: SQLAlchemy
autoflushes the staged rows before the query, which silently opens the SQLite
write transaction at that point, and it then stays open until the caller finally
commits.

SQLite permits many concurrent readers but exactly **one** writer. A write
transaction left open across the rest of a handler therefore blocks every other
writer for ``busy_timeout`` (10s) and then fails it with "database is locked".
On the owner's machine that surfaced as an unusable rating bar and
``复习会话仍在加载，评分暂不可用…``, with the session watchdog reporting:

    write transaction held 36.56s opened at _latest_active_for_workspace
    write transaction held 33.31s opened at _remember_operation
    write transaction held 27.38s opened at _operation_seen

while the requests themselves spent ~20 ms doing SQL.

Each lookup is therefore wrapped in ``session.no_autoflush``. That is correct on
two counts: it stops a read from opening a write, and it is semantically right —
the questions asked here ("which round is active?", "has this operation already
been applied?") are about committed state, so rows staged by the in-flight call
must not influence the answer. For ``operation_seen`` in particular, counting a
receipt staged by the same call would make a retry look like a duplicate and get
it silently skipped.

They are split out of ``round_state_service`` so the ordering contract above is
documented in one place rather than re-explained at each call site, and so the
service module stays within its size budget.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import (
    FreestyleRoundOperationReceipt,
    FreestyleRoundState,
)
from memory_anki.modules.practice.domain.workspace import normalize_workspace


def latest_active_round(session: Session, workspace: str) -> FreestyleRoundState | None:
    """The active round for a workspace slot. Read-only; never autoflushes."""
    slot = normalize_workspace(workspace)
    with session.no_autoflush:
        return (
            session.query(FreestyleRoundState)
            .filter(
                FreestyleRoundState.workspace == slot,
                FreestyleRoundState.status == "active",
            )
            .order_by(FreestyleRoundState.updated_at.desc(), FreestyleRoundState.round_id.desc())
            .first()
        )


def operation_already_applied(
    session: Session,
    row: FreestyleRoundState,
    operation_id: str,
) -> bool:
    """Has this operation already been applied to the round? Never autoflushes."""
    op_id = str(operation_id or "").strip()
    if not op_id:
        return False
    if row.last_operation_id == op_id:
        return True
    with session.no_autoflush:
        existing = session.get(FreestyleRoundOperationReceipt, op_id)
    return existing is not None and existing.round_id == row.round_id


def lookup_operation_receipt(
    session: Session,
    operation_id: str,
) -> FreestyleRoundOperationReceipt | None:
    """Fetch an operation receipt without flushing staged rows. Read-only."""
    op_id = str(operation_id or "").strip()
    if not op_id:
        return None
    with session.no_autoflush:
        return session.get(FreestyleRoundOperationReceipt, op_id)


__all__ = [
    "latest_active_round",
    "lookup_operation_receipt",
    "operation_already_applied",
]
