from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment

from .segment_nodes import (
    cleanup_segment_node_uids,
    parse_segment_node_uids,
    remaining_unclaimed_node_uids,
)


def palace_has_unassigned_nodes(palace: Palace) -> bool:
    return bool(remaining_unclaimed_node_uids(palace))


def get_segment_display_name(palace: Palace, segment: PalaceSegment) -> str:
    raw_name = str(segment.name or "").strip()
    if raw_name != "第 1 部分":
        return raw_name or f"第 {segment.sort_order + 1} 部分"
    index_offset = 1 if palace_has_unassigned_nodes(palace) else 0
    return f"第 {segment.sort_order + 1 + index_offset} 部分"


def segment_summary_json(session: Session, segment: PalaceSegment) -> dict[str, Any]:
    cleanup_segment_node_uids(session, segment.palace)
    node_uids = parse_segment_node_uids(segment.node_uids_json)
    return {
        "id": segment.id,
        "palace_id": segment.palace_id,
        "name": segment.name,
        "display_name": get_segment_display_name(segment.palace, segment),
        "color": segment.color,
        "created_at": segment.created_at.isoformat() if segment.created_at else None,
        "sort_order": segment.sort_order,
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "is_empty": not node_uids,
    }


def build_unassigned_segment_summary(palace: Palace) -> dict[str, Any] | None:
    node_uids = remaining_unclaimed_node_uids(palace)
    if not node_uids:
        return None
    return {
        "id": 0,
        "palace_id": palace.id,
        "name": "未分组内容",
        "display_name": "未分组内容",
        "color": "#94a3b8",
        "created_at": palace.created_at.isoformat() if palace.created_at else None,
        "sort_order": -1,
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "is_empty": False,
        "is_virtual_default": True,
    }


def list_palace_segments(
    session: Session,
    palace: Palace,
    *,
    unassigned_segment: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    cleanup_segment_node_uids(session, palace)
    items: list[dict[str, Any]] = []
    if unassigned_segment and unassigned_segment.get("node_uids"):
        items.append(unassigned_segment)
    items.extend(segment_summary_json(session, segment) for segment in palace.segments)
    return items


__all__ = [
    "build_unassigned_segment_summary",
    "get_segment_display_name",
    "list_palace_segments",
    "palace_has_unassigned_nodes",
    "segment_summary_json",
]
