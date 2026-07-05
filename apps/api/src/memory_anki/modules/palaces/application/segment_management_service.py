from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Palace, PalaceSegment
from memory_anki.modules.palaces.application.segment_nodes import (
    normalize_segment_node_uids,
    serialize_segment_node_uids,
)

SEGMENT_COLOR_PALETTE = [
    "#14b8a6",
    "#f97316",
    "#3b82f6",
    "#eab308",
    "#ec4899",
    "#8b5cf6",
]


def create_palace_segment(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
) -> PalaceSegment:
    normalized_uids = normalize_segment_node_uids(
        session,
        palace,
        [str(item or "").strip() for item in payload.get("node_uids", []) if str(item or "").strip()],
    )
    segment = PalaceSegment(
        palace_id=palace.id,
        name=str(payload.get("name") or "").strip() or _next_segment_name(palace),
        color=str(payload.get("color") or "").strip()
        or SEGMENT_COLOR_PALETTE[len(palace.segments) % len(SEGMENT_COLOR_PALETTE)],
        node_uids_json=serialize_segment_node_uids(normalized_uids),
        created_at=_parse_segment_datetime(payload.get("created_at"))
        or _default_segment_created_at(palace),
        sort_order=max([item.sort_order for item in palace.segments], default=-1) + 1,
    )
    session.add(segment)
    session.flush()
    session.commit()
    session.refresh(segment)
    return segment


def update_palace_segment(
    session: Session,
    segment: PalaceSegment,
    payload: dict[str, Any],
) -> PalaceSegment:
    if "name" in payload:
        segment.name = str(payload.get("name") or "").strip() or segment.name
    if "color" in payload:
        segment.color = str(payload.get("color") or "").strip() or segment.color
    if "created_at" in payload:
        parsed_created_at = _parse_segment_datetime(payload.get("created_at"))
        if parsed_created_at is not None:
            segment.created_at = parsed_created_at
    if "sort_order" in payload:
        segment.sort_order = max(0, int(payload.get("sort_order") or 0))
    if "node_uids" in payload:
        segment.node_uids_json = serialize_segment_node_uids(
            normalize_segment_node_uids(
                session,
                segment.palace,
                [str(item or "").strip() for item in payload.get("node_uids", []) if str(item or "").strip()],
                exclude_segment_id=segment.id,
            )
        )
    session.commit()
    session.refresh(segment)
    return segment


def delete_palace_segment(session: Session, segment: PalaceSegment) -> None:
    session.delete(segment)
    session.commit()


def get_palace_segment(session: Session, segment_id: int) -> PalaceSegment | None:
    return session.query(PalaceSegment).filter_by(id=segment_id).first()


def _next_segment_name(palace: Palace) -> str:
    return f"第 {len(palace.segments) + 1} 部分"


def _default_segment_created_at(palace: Palace) -> datetime:
    if not palace.segments and palace.created_at:
        return palace.created_at
    return utc_now_naive()


def _parse_segment_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
