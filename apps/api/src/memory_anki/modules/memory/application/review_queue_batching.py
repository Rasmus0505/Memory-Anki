"""Batch metadata and local-date grouping for the formal review queue."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.memory.application.wave_policy import local_date_of


def large_batch_hint_size(session: Session) -> int:
    from memory_anki.infrastructure.db._tables.misc import Config
    row = session.query(Config).filter_by(key="large_batch_hint_size").first()
    try:
        return max(1, int(row.value)) if row is not None and row.value else 60
    except (TypeError, ValueError):
        return 60

def unit_labels(session: Session, palace_id: int, node_uids: list[str]) -> dict[str, Any]:
    from memory_anki.modules.memory.application.scheduling.units import resolve_units
    try:
        units = resolve_units(session, palace_id)
    except Exception:
        return {"unit_root_uids": [], "unit_titles": [], "unit_kinds": []}
    touched = [unit for unit in units.values() if any(uid in unit.node_uids for uid in node_uids)]
    return {
        "unit_root_uids": [unit.unit_root_uid for unit in touched],
        "unit_titles": [unit.title for unit in touched if unit.kind == "mark" and unit.title],
        "unit_kinds": [unit.kind for unit in touched],
    }

def group_nodes_by_local_due_date(nodes: list[dict[str, Any]], parse_due) -> list[list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in nodes:
        due_at = parse_due(item.get("due_at"))
        key = local_date_of(due_at.replace(tzinfo=None)).isoformat() if due_at is not None else "unscheduled"
        grouped.setdefault(key, []).append(item)
    return [grouped[key] for key in sorted(grouped)]


def build_queue_item(session: Session, palace, nodes: list[dict[str, Any]], now, projection: dict[str, Any] | None = None, *, parse_due, today_review_count: int = 0, large_batch_hint_size: int = 60) -> dict[str, Any]:
    from memory_anki.core.time import to_api_datetime
    times = [parsed for item in nodes if (parsed := parse_due(item.get("due_at"))) is not None]
    next_due = to_api_datetime(min(times)) if times else None
    overdue = sum(1 for item in times if item < now)
    projection = projection or {}
    node_uids = [str(item["node_uid"]) for item in nodes if item.get("node_uid")]
    local_day = local_date_of(min(times).replace(tzinfo=None)).isoformat() if times else None
    return {
        "batch_key": f"{palace.id}:{local_day or 'unscheduled'}", "batch_local_date": local_day,
        "batch_due_node_uids": node_uids, "batch_node_count": len(node_uids),
        "oversized": len(node_uids) > max(1, large_batch_hint_size), **unit_labels(session, int(palace.id), node_uids),
        "id": palace.id, "palace_id": palace.id, "session_id": None, "algorithm_used": "FSRS",
        "scheduled_date": next_due[:10] if next_due else now.date().isoformat(), "due_at": next_due, "next_due_at": next_due,
        "completed": False, "review_number": 0, "review_type": "fsrs", "interval_days": None,
        "due_node_count": len(nodes), "overdue_node_count": overdue, "schedule_count": len(nodes),
        "overdue_schedule_count": overdue, "next_due_date": next_due[:10] if next_due else now.date().isoformat(),
        "review_entry_mode": projection.get("review_entry_mode") or "palace", "review_entry_label": projection.get("review_entry_label"),
        "primary_branch_uid": projection.get("primary_branch_uid"), "primary_branch_title": projection.get("primary_branch_title"),
        "due_branch_count": projection.get("due_branch_count") or 0, "review_branch_summaries": list(projection.get("review_branch_summaries") or []),
        "today_review_count": max(0, int(today_review_count)),
        "palace": {"id": palace.id, "title": palace.manual_title or palace.title or "未命名宫殿", "description": palace.description or "", "archived": bool(palace.archived), "mastered": False, "editor_doc": None, "pegs": [], "attachments": [], "chapters": []},
    }
