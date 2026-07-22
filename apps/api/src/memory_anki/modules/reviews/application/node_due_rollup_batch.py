"""Batch due-rollup loading for queue / freestyle / catalog list paths."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.reviews.application.node_memory_projection import (
    _aware,
    _projection_from_tree,
    _schedule_settings,
    _scheduler,
    _tree,
    _utc_now,
)


def load_palace_node_states_for_ids(
    session: Session, palace_ids: list[int] | set[int] | tuple[int, ...]
) -> dict[int, dict[str, ReviewNodeState]]:
    """Load ReviewNodeState rows for many palaces in one query."""
    ids = [int(palace_id) for palace_id in palace_ids]
    if not ids:
        return {}
    result: dict[int, dict[str, ReviewNodeState]] = {palace_id: {} for palace_id in ids}
    rows = (
        session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id.in_(ids))
        .all()
    )
    for row in rows:
        result.setdefault(int(row.palace_id), {})[row.node_uid] = row
    return result


def _rollup_from_projection(projection: dict[str, Any]) -> dict[str, Any]:
    return {
        "palace_id": projection["palace_id"],
        "node_count": projection["node_count"],
        "mastery_progress": projection["mastery_progress"],
        "mastery_percent": projection["mastery_percent"],
        "memory_health": projection["memory_health"],
        "memory_health_percent": projection["memory_health_percent"],
        "mastered_node_count": projection["mastered_node_count"],
        "mastery_horizon_days": projection["mastery_horizon_days"],
        "due_node_count": projection["due_node_count"],
        "overdue_node_count": projection["overdue_node_count"],
        "next_review_at": projection["next_review_at"],
        "mastered": projection["mastered"],
        "severe_weak_node_count": projection["severe_weak_node_count"],
        "has_due_review": projection["has_due_review"],
        "review_entry_mode": projection.get("review_entry_mode") or "none",
        "review_entry_label": projection.get("review_entry_label"),
        "primary_branch_uid": projection.get("primary_branch_uid"),
        "primary_branch_title": projection.get("primary_branch_title"),
        "due_branch_count": projection.get("due_branch_count") or 0,
        "due_node_uids": list(projection.get("due_node_uids") or []),
        "review_branch_summaries": list(projection.get("review_branch_summaries") or []),
        "nodes": list(projection.get("nodes") or []),
    }


def project_due_rollups_batch(
    session: Session,
    palaces: list[Palace],
    *,
    now: datetime | None = None,
    include_nodes: bool = True,
) -> dict[int, dict[str, Any]]:
    """Build due rollups for many palaces with one states query and one FSRS config load.

    When ``now`` is None, results are stored in the session-scoped due-rollup cache so
    freestyle/list paths can share work within a single request.
    """
    if not palaces:
        return {}

    cache = session.info.setdefault("_palace_due_rollup_cache", {})
    results: dict[int, dict[str, Any]] = {}
    missing: list[Palace] = []
    for palace in palaces:
        palace_id = int(palace.id)
        if now is None and palace_id in cache:
            results[palace_id] = dict(cache[palace_id])
        else:
            missing.append(palace)

    if not missing:
        return results

    states_by_palace = load_palace_node_states_for_ids(
        session, [int(palace.id) for palace in missing]
    )
    _, _, mastery_horizon_days = _schedule_settings(session)
    shared_scheduler = _scheduler(session)
    resolved_now = _aware(now) or _utc_now()

    for palace in missing:
        palace_id = int(palace.id)
        root_uid, nodes = _tree(palace)
        projection = _projection_from_tree(
            session,
            palace,
            root_uid=root_uid,
            nodes=nodes,
            states=states_by_palace.get(palace_id, {}),
            now=resolved_now,
            include_ratings=False,
            include_nodes=include_nodes,
            scheduler=shared_scheduler,
            mastery_horizon_days=mastery_horizon_days,
        )
        payload = _rollup_from_projection(projection)
        if now is None:
            cache[palace_id] = payload
        results[palace_id] = dict(payload)
    return results


__all__ = [
    "load_palace_node_states_for_ids",
    "project_due_rollups_batch",
]
