from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Palace, PalaceMiniPalace
from memory_anki.modules.palaces.application.mini_palace_nodes import (
    cleanup_mini_palace_node_uids,
    normalize_mini_palace_node_uids,
    parse_mini_palace_node_uids,
    resolve_mini_palace_name,
    serialize_mini_palace_node_uids,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    get_reviewable_doc_node_uids,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    calculate_reveal_progress,
    get_mini_review_progress,
)

from .mini_palace_review_support import (
    mini_palace_progress_state,
    resolve_mini_palace_algorithm,
)
from .mini_palace_review_timing import (
    build_mini_palace_timing,
    ensure_mini_palace_schedule_model,
    mini_review_stages_json,
)


def list_palace_mini_palaces(session: Session, palace: Palace) -> list[dict[str, Any]]:
    changed = cleanup_mini_palace_node_uids(session, palace)
    schedule_changed = False
    for mini_palace in palace.mini_palaces:
        schedule_changed = ensure_mini_palace_schedule_model(session, mini_palace) or schedule_changed
    if changed or schedule_changed:
        session.commit()
        session.refresh(palace)
    return [mini_palace_summary_json(item, session) for item in palace.mini_palaces]


def mini_palace_summary_json(
    mini_palace: PalaceMiniPalace,
    session: Session | None = None,
) -> dict[str, Any]:
    node_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
    if session is None:
        review_stage_total = 0
        review_stage_completed = 0
        review_stage_progress = 0.0
        stage_labels: list[str] = []
        review_stages: list[dict[str, Any]] = []
        next_review_at = None
        has_due_review = False
        current_review_schedule_id = None
        current_review_type = None
        active_review_progress = None
    else:
        ensure_mini_palace_schedule_model(session, mini_palace)
        review_stage_total, review_stage_completed, review_stage_progress = mini_palace_progress_state(
            session,
            mini_palace,
        )
        algorithm = resolve_mini_palace_algorithm(session, mini_palace)
        stage_labels = get_algorithm_stage_labels(session, algorithm)
        review_stages = mini_review_stages_json(session, mini_palace, stage_labels)
        timing = build_mini_palace_timing(session, mini_palace)
        next_review_at = timing["next_review_at"]
        has_due_review = timing["has_due_review"]
        current_review_schedule_id = timing["current_review_schedule_id"]
        current_review_type = timing["current_review_type"]
        active_review_progress = None
        if current_review_schedule_id is not None:
            review_progress = get_mini_review_progress(session, current_review_schedule_id)
            if review_progress:
                review_doc = build_segments_editor_doc(mini_palace.palace, [node_uids])
                active_review_progress = calculate_reveal_progress(
                    review_progress,
                    get_reviewable_doc_node_uids(review_doc),
                )
    estimated_review_seconds = estimate_mini_review_seconds(mini_palace)
    return {
        "id": mini_palace.id,
        "palace_id": mini_palace.palace_id,
        "name": mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}",
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "sort_order": mini_palace.sort_order,
        "created_at": mini_palace.created_at.isoformat() if mini_palace.created_at else None,
        "updated_at": mini_palace.updated_at.isoformat() if mini_palace.updated_at else None,
        "is_empty": len(node_uids) == 0,
        "needs_practice": bool(getattr(mini_palace, "needs_practice", False)),
        "estimated_review_seconds": estimated_review_seconds,
        "review_stage_total": review_stage_total,
        "review_stage_completed": review_stage_completed,
        "review_stage_progress": review_stage_progress,
        "stage_labels": stage_labels,
        "review_stages": review_stages,
        "next_review_at": next_review_at,
        "has_due_review": has_due_review,
        "current_review_schedule_id": current_review_schedule_id,
        "current_review_type": current_review_type,
        "active_review_progress": active_review_progress,
    }


def create_palace_mini_palace(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
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
    ensure_mini_palace_schedule_model(session, mini_palace)
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def update_palace_mini_palace(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
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
    ensure_mini_palace_schedule_model(session, mini_palace)
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def delete_palace_mini_palace(session: Session, mini_palace: PalaceMiniPalace) -> None:
    session.delete(mini_palace)
    session.commit()


def get_palace_mini_palace(
    session: Session,
    mini_palace_id: int,
) -> PalaceMiniPalace | None:
    return session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()


def estimate_mini_review_seconds(mini_palace: PalaceMiniPalace) -> int:
    logs = mini_palace.review_logs or []
    total_duration = sum(max(0, int(log.duration_seconds or 0)) for log in logs)
    node_count = len(parse_mini_palace_node_uids(mini_palace.node_uids_json))
    if total_duration > 0 and logs:
        return max(60, round(total_duration / len(logs)))
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
