from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceMiniPalace
from memory_anki.modules.palaces.application.mini_palace_nodes import (
    normalize_mini_palace_node_uids,
    parse_mini_palace_node_uids,
    resolve_mini_palace_name,
    serialize_mini_palace_node_uids,
)
from memory_anki.platform.application import UnitOfWork


def list_palace_mini_palaces(session: Session, palace: Palace) -> list[dict[str, Any]]:
    return [mini_palace_summary_json(item, session) for item in palace.mini_palaces]


def mini_palace_summary_json(
    mini_palace: PalaceMiniPalace,
    session: Session | None = None,
) -> dict[str, Any]:
    stored_node_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
    palace = getattr(mini_palace, "palace", None)
    node_uids = (
        normalize_mini_palace_node_uids(palace, stored_node_uids)
        if palace is not None
        else stored_node_uids
    )
    estimated_review_seconds = max(60, len(node_uids) * 45) if node_uids else 0
    return {
        "id": mini_palace.id,
        "palace_id": mini_palace.palace_id,
        "name": mini_palace.name or f"迷你宫殿训练 {mini_palace.sort_order + 1}",
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "sort_order": mini_palace.sort_order,
        "created_at": mini_palace.created_at.isoformat() if mini_palace.created_at else None,
        "updated_at": mini_palace.updated_at.isoformat() if mini_palace.updated_at else None,
        "is_empty": len(node_uids) == 0,
        "needs_practice": bool(getattr(mini_palace, "needs_practice", False)),
        "estimated_review_seconds": estimated_review_seconds,
        "review_stage_total": 0,
        "review_stage_completed": 0,
        "review_stage_progress": 0.0,
        "stage_labels": [],
        "review_stages": [],
        "next_review_at": None,
        "has_due_review": False,
        "current_review_schedule_id": None,
        "current_review_type": None,
        "active_review_progress": None,
    }


def create_palace_mini_palace(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: Callable[[PalaceMiniPalace], None] | None = None,
) -> PalaceMiniPalace:
    normalized_node_uids = normalize_mini_palace_node_uids(
        palace,
        payload.get("node_uids", []),
    )
    mini_palace = PalaceMiniPalace(
        palace_id=palace.id,
        name=resolve_mini_palace_name(
            palace,
            payload.get("name"),
            node_uids=normalized_node_uids,
        ),
        node_uids_json=serialize_mini_palace_node_uids(normalized_node_uids),
        needs_practice=bool(payload.get("needs_practice", False)),
        sort_order=max([item.sort_order for item in palace.mini_palaces], default=-1) + 1,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(mini_palace)
    session.flush()
    if before_commit is not None:
        before_commit(mini_palace)
    uow.commit()
    uow.refresh(mini_palace)
    return mini_palace


def update_palace_mini_palace(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
) -> PalaceMiniPalace:
    normalized_node_uids = None
    if "node_uids" in payload:
        normalized_node_uids = normalize_mini_palace_node_uids(
            mini_palace.palace,
            payload.get("node_uids", []),
        )
    if "name" in payload:
        mini_palace.name = resolve_mini_palace_name(
            mini_palace.palace,
            payload.get("name"),
            node_uids=normalized_node_uids,
            exclude_id=mini_palace.id,
        )
    if normalized_node_uids is not None:
        mini_palace.node_uids_json = serialize_mini_palace_node_uids(normalized_node_uids)
    if "sort_order" in payload:
        mini_palace.sort_order = max(0, int(payload.get("sort_order") or 0))
    if "needs_practice" in payload:
        mini_palace.needs_practice = bool(payload.get("needs_practice", False))
    mini_palace.updated_at = utc_now_naive()
    uow.commit()
    uow.refresh(mini_palace)
    return mini_palace


def delete_palace_mini_palace(
    session: Session,
    mini_palace: PalaceMiniPalace,
    *,
    uow: UnitOfWork,
) -> None:
    session.delete(mini_palace)
    uow.commit()


def get_palace_mini_palace(
    session: Session,
    mini_palace_id: int,
) -> PalaceMiniPalace | None:
    return session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()


def estimate_mini_review_seconds(mini_palace: PalaceMiniPalace) -> int:
    node_count = len(parse_mini_palace_node_uids(mini_palace.node_uids_json))
    if node_count > 0:
        return max(60, node_count * 45)
    return 0


__all__ = [
    "create_palace_mini_palace",
    "delete_palace_mini_palace",
    "estimate_mini_review_seconds",
    "get_palace_mini_palace",
    "list_palace_mini_palaces",
    "mini_palace_summary_json",
    "update_palace_mini_palace",
]
