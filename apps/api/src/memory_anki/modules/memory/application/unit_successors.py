"""Follow a retired review unit to the live unit that now owns its content.

A permanent-mark edit can retire a unit row and merge its nodes into a
neighbouring unit under a new identity (unmarking B1 folds B1 into the palace's
residual unit). Callers holding the old unit id — a freestyle round card, an
open glance — must follow the content instead of reporting "review unit not
found" or dropping the learner onto unrelated work.

Only storage-shaped facts are used: the retired row's anchor and stored node
members, and the active rows' stored node members. No ``editor_doc`` parsing.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState


def _members(raw: str | None) -> set[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return set()
    if not isinstance(value, list):
        return set()
    return {str(item) for item in value if item}


def pick_successor(
    retired: ReviewUnitState,
    live_rows: Sequence[ReviewUnitState],
) -> ReviewUnitState | None:
    """The live row that continues ``retired``, or ``None`` when it split away.

    Order matters:

    1. Same anchor. Marking/unmarking the palace root flips between a
       root-mark palace unit and a root-anchored residual unit; the mark that
       stayed put is the continuation.
    2. Exactly one live unit owns the retired anchor node. An unmarked child
       flowed into its parent's residual unit, and node ownership is unambiguous
       because split units partition every non-root node.
    3. Mostly the same content (at least half the nodes), used when the anchor
       node itself was deleted or moved. A split is not a continuation, so an
       ambiguous or weak overlap returns ``None``.
    """
    anchor = str(retired.anchor_uid or "")
    live = list(live_rows)
    same_anchor = [row for row in live if str(row.anchor_uid or "") == anchor]
    if len(same_anchor) == 1:
        return same_anchor[0]
    same_kind = [
        row for row in same_anchor if str(row.unit_kind or "") == str(retired.unit_kind or "")
    ]
    if len(same_kind) == 1:
        return same_kind[0]

    owners = [row for row in live if anchor and anchor in _members(row.node_uids_json)]
    if len(owners) == 1:
        return owners[0]

    retired_nodes = _members(retired.node_uids_json)
    if not retired_nodes:
        return None
    best: ReviewUnitState | None = None
    best_overlap = 0
    ambiguous = False
    for row in live:
        overlap = len(retired_nodes & _members(row.node_uids_json))
        if overlap > best_overlap:
            best, best_overlap, ambiguous = row, overlap, False
        elif overlap == best_overlap and overlap > 0:
            ambiguous = True
    if best is None or ambiguous:
        return None
    if best_overlap * 2 < len(retired_nodes):
        return None
    return best


def resolve_unit_successors(
    session: Session,
    unit_ids: Sequence[str],
) -> dict[str, str]:
    """Retired unit id -> live successor unit id, for the ids in ``unit_ids``.

    Live units and units of deleted/archived palaces have no entry. Read-only.
    """
    wanted = [str(item).strip() for item in unit_ids if str(item).strip()]
    if not wanted:
        return {}
    rows = (
        session.query(ReviewUnitState)
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.id.in_(wanted),
            ReviewUnitState.permanently_removed.is_(False),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .all()
    )
    retired = [row for row in rows if not row.active]
    if not retired:
        return {}
    palace_ids = sorted({int(row.palace_id) for row in retired})
    live_rows = (
        session.query(ReviewUnitState)
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.palace_id.in_(palace_ids),
            ReviewUnitState.active.is_(True),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .all()
    )
    by_palace: dict[int, list[ReviewUnitState]] = {}
    for row in live_rows:
        by_palace.setdefault(int(row.palace_id), []).append(row)
    result: dict[str, str] = {}
    for row in retired:
        successor = pick_successor(row, by_palace.get(int(row.palace_id), []))
        if successor is not None:
            result[str(row.id)] = str(successor.id)
    return result


__all__ = ["pick_successor", "resolve_unit_successors"]
