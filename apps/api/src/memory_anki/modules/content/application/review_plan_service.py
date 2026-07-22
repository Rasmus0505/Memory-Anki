"""Palace review plan projection from FSRS node due times."""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.memory.api import get_palace_memory_projection

from .palace_service import get_palace


def _due_date_key(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value[:10] if len(value) >= 10 else value
    return parsed.date().isoformat()


def build_palace_review_plan(session: Session, palace_id: int) -> dict | None:
    palace = get_palace(session, palace_id)
    if palace is None:
        return None
    try:
        projection = get_palace_memory_projection(session, palace.id)
    except ValueError:
        projection = {"nodes": []}
    grouped: OrderedDict[str | None, list[dict[str, Any]]] = OrderedDict()
    for node in projection.get("nodes") or []:
        key = _due_date_key(node.get("due_at"))
        grouped.setdefault(key, []).append(node)
    plan: list[dict[str, Any]] = []
    for date_key, nodes in grouped.items():
        due_count = sum(1 for item in nodes if item.get("due"))
        plan.append(
            {
                "date": date_key,
                "representative_schedule_id": 0,
                "schedule_count": len(nodes),
                "pending_count": due_count if due_count else len(nodes),
                "completed_count": 0,
                "completed": False,
                "review_number": 0,
                "interval_days": 0,
                "review_type": "fsrs",
                "due_node_count": len(nodes),
            }
        )
    return {
        "palace_id": palace.id,
        "palace_title": palace.manual_title or palace.title,
        "plan": plan,
    }
