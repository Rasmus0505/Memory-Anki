"""Queue/completion extras: next-wave scope labels and per-palace today counts."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import ReviewLog


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def next_review_scope_from_projection(projection: dict[str, Any]) -> dict[str, Any]:
    """Describe the next review wave: node count + node/palace entry mode.

    Used on completion receipts so the learner can tell whether the next pass
    is a single-branch node review or a full-palace session.
    """
    nodes = list(projection.get("nodes") or [])
    due_now = [item for item in nodes if item.get("due")]
    if due_now:
        mode = str(projection.get("review_entry_mode") or "palace")
        label = projection.get("review_entry_label")
        if mode == "none":
            mode = "palace"
            label = "开始复习"
        return {
            "next_review_node_count": len(due_now),
            "next_review_entry_mode": mode,
            "next_review_entry_label": label or ("节点复习" if mode == "node" else "开始复习"),
        }

    next_raw = projection.get("next_review_at")
    next_at = _dt(next_raw if isinstance(next_raw, str) else None)
    if next_at is None:
        return {
            "next_review_node_count": 0,
            "next_review_entry_mode": "none",
            "next_review_entry_label": None,
        }

    # Earliest cohort: nodes sharing the soonest due instant (next review wave).
    cohort: list[dict[str, Any]] = []
    for item in nodes:
        due_at = _dt(item.get("due_at") if isinstance(item.get("due_at"), str) else None)
        if due_at is not None and due_at == next_at:
            cohort.append(item)

    if not cohort:
        return {
            "next_review_node_count": 0,
            "next_review_entry_mode": "none",
            "next_review_entry_label": None,
        }

    branch_uids = {
        str(item["branch_uid"])
        for item in cohort
        if item.get("branch_uid")
    }
    if len(branch_uids) == 1:
        branch_uid = next(iter(branch_uids))
        title = None
        for summary in projection.get("review_branch_summaries") or []:
            if str(summary.get("branch_uid") or "") == branch_uid:
                raw_title = str(summary.get("title") or "").strip()
                title = raw_title or None
                break
        return {
            "next_review_node_count": len(cohort),
            "next_review_entry_mode": "node",
            "next_review_entry_label": f"节点复习 · {title}" if title else "节点复习",
        }
    return {
        "next_review_node_count": len(cohort),
        "next_review_entry_mode": "palace",
        "next_review_entry_label": "整宫复习",
    }


def today_review_counts_by_palace(
    session: Session, palace_ids: list[int]
) -> dict[int, int]:
    """Count completed formal reviews per palace for local today.

    Each completed session (full-palace or node-scope) writes one ReviewLog row.
    """
    if not palace_ids:
        return {}
    today = date.today()
    rows = (
        session.query(ReviewLog.palace_id, func.count(ReviewLog.id))
        .filter(
            ReviewLog.palace_id.in_(palace_ids),
            ReviewLog.review_date == today,
        )
        .group_by(ReviewLog.palace_id)
        .all()
    )
    return {int(palace_id): int(count) for palace_id, count in rows}
