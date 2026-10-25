"""睡前复习: append today's studied palaces to the open round.

Bedtime review is a second pass over content the learner already finished
today. It reviews **one whole palace as one unit** — not each permanent-mark
slice — and never starts a round of its own: the palace cards are appended to
the end of the current plan, marked ``bedtime`` / ``palace_pass``, and scored
through a plan-only path so their grades cannot move the review schedule.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_day
from memory_anki.modules.memory.public.queries import (
    list_units_rated_on,
    resolve_unit_definitions,
)

from ..domain.round_plan_values import _text
from ..domain.workspace import is_palace_review_workspace


def workspace_palace_ids(workspace: Any) -> list[int] | None:
    """Palace scope of a round: the palace-review slot, or None for 随心."""
    text = str(workspace or "").strip()
    if is_palace_review_workspace(text):
        return [int(text[1:])]
    return None


def collect_bedtime_cards(
    session: Session,
    plan: dict[str, Any],
    *,
    workspace: Any,
) -> list[dict[str, Any]]:
    """One bedtime card per palace that was studied today.

    A palace is the bedtime unit: the learner sees the whole mind map and gives
    one grade for it. A palace already carrying a bedtime card is never appended
    again, so rating another unit inside it does not create a second pass; only
    a palace that gets its first rating today is new.

    ``unit_id`` is a real rated unit used as the *preview handle* (the read-only
    preview API loads the palace document through a unit). The grade never
    targets that unit: ``bedtime_ratings`` is a plan-only record.
    """
    today = local_day()
    rated_rows = list_units_rated_on(
        session,
        today,
        workspace_palace_ids(workspace),
    )
    if not rated_rows:
        return []
    cards = [item for item in plan.get("original_cards") or [] if isinstance(item, dict)]
    bedtime_palaces = {
        int(item["palace_id"])
        for item in cards
        if item.get("bedtime") and item.get("palace_id")
    }
    by_palace: dict[int, list[dict[str, Any]]] = {}
    for row in rated_rows:
        palace_id = int(row["palace_id"])
        if palace_id in bedtime_palaces:
            continue
        by_palace.setdefault(palace_id, []).append(row)
    cards_out: list[dict[str, Any]] = []
    for palace_id, rows in by_palace.items():
        try:
            tree, _definitions = resolve_unit_definitions(session, palace_id)
        except ValueError:
            continue
        raw_nodes = tree.get("nodes") if isinstance(tree, dict) else None
        nodes = raw_nodes if isinstance(raw_nodes, dict) else {}
        representative = rows[0]
        anchor = _text(representative.get("anchor_uid"))
        title = _text(representative.get("title"))
        root = next(
            (str(uid) for uid, node in nodes.items() if not node.get("parent_uid")),
            anchor,
        )
        node_uids = tuple(str(uid) for uid in nodes if str(uid).strip())
        if not node_uids:
            node_uids = tuple(
                str(uid) for uid in representative.get("node_uids") or [] if str(uid).strip()
            )
        if not node_uids and anchor:
            node_uids = (anchor,)
        cards_out.append(
            {
                "id": f"bedtime:palace:{palace_id}:{today.isoformat()}",
                "type": "mindmap_branch",
                "content_type": "mindmap_branch",
                "presentation": "palace",
                "palace_id": palace_id,
                "palace_title": title,
                "anchor_uid": root or anchor,
                "context_path": [
                    {"uid": root or anchor or f"palace:{palace_id}", "text": title}
                ],
                "node_uids": list(node_uids),
                "node_count": len(node_uids),
                "phase": "fill",
                "is_new": False,
                "palace_context": {
                    "id": palace_id,
                    "title": title,
                    "resolved_title": title,
                },
                "unit_id": _text(representative.get("id")),
                "unit_revision": int(representative.get("revision") or 1),
                "bedtime": True,
                "palace_pass": True,
            }
        )
    return cards_out


__all__ = ["collect_bedtime_cards", "workspace_palace_ids"]
