"""Temporary freestyle split marks: CRUD + settlement completion."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import FreestyleTemporaryMark
from memory_anki.modules.content.application.tree_structure import get_palace_tree_structure
from memory_anki.modules.practice.domain.branch_units import subtree_uids


def list_active_temporary_roots(
    session: Session,
    *,
    palace_id: int | None = None,
) -> dict[int, list[str]]:
    """Return palace_id -> active (incomplete) temporary root uids."""
    query = session.query(FreestyleTemporaryMark).filter(
        FreestyleTemporaryMark.completed == False  # noqa: E712
    )
    if palace_id is not None:
        query = query.filter(FreestyleTemporaryMark.palace_id == int(palace_id))
    rows = query.order_by(FreestyleTemporaryMark.palace_id.asc(), FreestyleTemporaryMark.id.asc()).all()
    result: dict[int, list[str]] = {}
    for row in rows:
        result.setdefault(int(row.palace_id), []).append(str(row.node_uid))
    return result


def get_palace_temporary_marks(session: Session, palace_id: int) -> dict[str, Any]:
    rows = (
        session.query(FreestyleTemporaryMark)
        .filter(FreestyleTemporaryMark.palace_id == int(palace_id))
        .order_by(FreestyleTemporaryMark.id.asc())
        .all()
    )
    return {
        "palace_id": int(palace_id),
        "marks": [
            {
                "node_uid": str(row.node_uid),
                "completed": bool(row.completed),
            }
            for row in rows
        ],
        "active_root_uids": [
            str(row.node_uid) for row in rows if not bool(row.completed)
        ],
    }


def replace_palace_temporary_marks(
    session: Session,
    *,
    palace_id: int,
    node_uids: list[str],
    unify_progress: bool = False,
    operation_id: str | None = None,
) -> dict[str, Any]:
    """Replace active temporary marks for a palace and optionally unify FSRS.

    Stores **all** valid node_uids (excluding palace root). Nested L2/L3 marks
    are kept — do **not** filter_outermost_roots when saving. Temporary and
    permanent marks share freestyle split topology; temporary is lifecycle-only.

    Confirmation is destructive for FSRS when unify_progress is True: averages
    existing FSRS states across the union of all marked uids' subtrees
    (deduped) and writes back to the whole group.
    """
    palace = session.get(Palace, int(palace_id))
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")

    tree = get_palace_tree_structure(session, int(palace_id))
    nodes = tree["nodes"]
    root_uid = tree.get("root_uid")
    requested = [str(uid) for uid in node_uids if str(uid).strip()]
    # Preserve request order; dedupe; keep nested marks (no outermost filter).
    valid: list[str] = []
    seen_valid: set[str] = set()
    for uid in requested:
        if uid in nodes and uid != root_uid and uid not in seen_valid:
            valid.append(uid)
            seen_valid.add(uid)

    # Replace all marks for this palace (completed or not).
    session.query(FreestyleTemporaryMark).filter(
        FreestyleTemporaryMark.palace_id == int(palace_id)
    ).delete(synchronize_session=False)
    session.flush()

    now = utc_now_naive()
    for uid in valid:
        session.add(
            FreestyleTemporaryMark(
                palace_id=int(palace_id),
                node_uid=uid,
                completed=False,
                created_at=now,
                updated_at=now,
            )
        )
    session.flush()

    unify_result: dict[str, Any] | None = None
    if unify_progress and valid:
        from memory_anki.modules.memory.application.temporary_mark_unify import (
            unify_fsrs_progress_for_node_groups,
        )

        group_uids: list[str] = []
        seen: set[str] = set()
        for mark_uid in valid:
            for uid in subtree_uids(nodes, mark_uid, include_self=True):
                if uid == root_uid or uid in seen:
                    continue
                seen.add(uid)
                group_uids.append(uid)
        unify_result = unify_fsrs_progress_for_node_groups(
            session,
            palace_id=int(palace_id),
            node_uids=group_uids,
            operation_id=operation_id,
            commit=False,
        )

    session.commit()
    return {
        "palace_id": int(palace_id),
        "active_root_uids": valid,
        "marks": [{"node_uid": uid, "completed": False} for uid in valid],
        "unify": unify_result,
    }


def clear_palace_temporary_marks(session: Session, palace_id: int) -> dict[str, Any]:
    deleted = (
        session.query(FreestyleTemporaryMark)
        .filter(FreestyleTemporaryMark.palace_id == int(palace_id))
        .delete(synchronize_session=False)
    )
    session.commit()
    return {"palace_id": int(palace_id), "deleted": int(deleted)}


def mark_temporary_roots_completed_on_settlement(
    session: Session,
    *,
    palace_id: int,
    branch_or_scope_uids: list[str] | set[str],
    had_good_or_easy: bool,
) -> list[str]:
    """Mark matching temporary roots completed when settlement includes Good/Easy.

    Nested marks complete when their unit root (or any mark uid) is in the
    settlement scope. Returns newly completed root uids. Does not reset on
    forget/hard.
    """
    if not had_good_or_easy:
        return []
    active = (
        session.query(FreestyleTemporaryMark)
        .filter(
            FreestyleTemporaryMark.palace_id == int(palace_id),
            FreestyleTemporaryMark.completed == False,  # noqa: E712
        )
        .all()
    )
    if not active:
        return []
    scope = {str(uid) for uid in branch_or_scope_uids}
    completed_now: list[str] = []
    now = utc_now_naive()
    for row in active:
        root = str(row.node_uid)
        # Complete when the temporary unit root is in scope, or any of its scope
        # nodes were part of this freestyle unit (branch_uid match preferred).
        if root in scope:
            row.completed = True
            row.updated_at = now
            completed_now.append(root)
    if completed_now:
        session.flush()
    return completed_now


__all__ = [
    "clear_palace_temporary_marks",
    "get_palace_temporary_marks",
    "list_active_temporary_roots",
    "mark_temporary_roots_completed_on_settlement",
    "replace_palace_temporary_marks",
]
