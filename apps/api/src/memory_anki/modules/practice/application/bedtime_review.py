"""睡前复习: append today's already-rated units to the open round.

Bedtime review is a second pass over content the learner already finished
today. It never starts a round of its own: the cards are appended to the end of
the current plan, marked ``bedtime``, and scored through a plan-only path so
their grades cannot move the review schedule. Units the round still owes today
(a pending retry, an unrated card) are left alone -- their real rating is what
they need.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_day
from memory_anki.modules.memory.public.queries import (
    list_units_rated_on,
    resolve_unit_definitions,
)

from ..domain.queue_builder import unit_key
from ..domain.review_units import ReviewUnitCandidate, context_path_including_anchor
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
    """Today's rated units that are not already in, or still owed by, this round."""
    rated_rows = list_units_rated_on(
        session,
        local_day(),
        workspace_palace_ids(workspace),
    )
    if not rated_rows:
        return []
    cards = [item for item in plan.get("original_cards") or [] if isinstance(item, dict)]
    card_ids = {_text(item.get("card_id")) for item in cards}
    settled = {
        _text(item)
        for key in ("completed_ids", "excluded_ids", "compressed_ids")
        for item in plan.get(key) or []
    }
    bedtime_units = {
        _text(item.get("unit_id"))
        for item in cards
        if item.get("bedtime") and _text(item.get("unit_id"))
    }
    unfinished_units = {
        _text(item.get("unit_id"))
        for item in cards
        if _text(item.get("unit_id"))
        and _text(item.get("card_id")) in card_ids
        and _text(item.get("card_id")) not in settled
    }
    for occurrence in plan.get("occurrences") or []:
        if not isinstance(occurrence, dict):
            continue
        if _text(occurrence.get("status")) not in {"pending", "inserted"}:
            continue
        unit_id = _text(occurrence.get("source_unit_id"))
        if not unit_id:
            continue
        source_id = _text(occurrence.get("source_card_id"))
        for item in cards:
            if _text(item.get("card_id")) == source_id:
                unit_id = _text(item.get("unit_id")) or unit_id
                break
        unfinished_units.add(unit_id)
    selected = [
        row
        for row in rated_rows
        if _text(row.get("id")) not in bedtime_units
        and _text(row.get("id")) not in unfinished_units
    ]
    if not selected:
        return []
    nodes_by_palace: dict[int, dict[str, Any]] = {}
    cards_out: list[dict[str, Any]] = []
    for row in selected:
        palace_id = int(row["palace_id"])
        if palace_id not in nodes_by_palace:
            try:
                tree, _definitions = resolve_unit_definitions(session, palace_id)
                nodes = tree.get("nodes") if isinstance(tree, dict) else None
                nodes_by_palace[palace_id] = nodes if isinstance(nodes, dict) else {}
            except ValueError:
                nodes_by_palace[palace_id] = {}
        anchor = _text(row.get("anchor_uid"))
        node_uids = tuple(str(uid) for uid in row.get("node_uids") or [] if str(uid).strip())
        if not node_uids and anchor:
            node_uids = (anchor,)
        path = context_path_including_anchor(nodes_by_palace[palace_id], anchor)
        title = _text(row.get("title"))
        if not path:
            path = ({"uid": anchor or _text(row.get("id")), "text": title},)
        unit = ReviewUnitCandidate(
            palace_id=palace_id,
            anchor_uid=anchor,
            context_path=path,
            node_uids=node_uids,
            unit_id=_text(row.get("id")),
            revision=int(row.get("revision") or 1),
            unit_kind=_text(row.get("unit_kind")),
            due_date=row.get("due_date"),
            last_passed_at=row.get("last_passed_at"),
            has_passed=bool(row.get("has_passed")),
            topology_order=int(row.get("topology_order") or 0),
        )
        cards_out.append(
            {
                "id": unit_key(unit),
                "type": "mindmap_branch",
                "content_type": "mindmap_branch",
                "presentation": "palace",
                "palace_id": palace_id,
                "palace_title": title,
                "anchor_uid": anchor,
                "context_path": list(path),
                "node_uids": list(node_uids),
                "node_count": len(node_uids),
                "phase": "fill",
                "is_new": not unit.has_passed,
                "palace_context": {
                    "id": palace_id,
                    "title": title,
                    "resolved_title": title,
                },
                "unit_id": unit.unit_id,
                "unit_revision": unit.revision,
                "bedtime": True,
            }
        )
    return cards_out


__all__ = ["collect_bedtime_cards", "workspace_palace_ids"]
