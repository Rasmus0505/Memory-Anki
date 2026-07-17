"""Node-level FSRS scheduling and rating operations."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, cast

from fsrs import Card, Rating, State
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
)
from memory_anki.modules.reviews.application.fsrs_runtime import (
    DEFAULT_MAXIMUM_INTERVAL,
    DEFAULT_RETENTION,
    PARAMETER_VERSION,
    RATING_LABELS,
    SCHEDULER_VERSION,
    VALID_RATINGS,
    build_scheduler,
    load_fsrs_settings,
)

# Re-export for existing imports/tests.
__all__ = [
    "RATING_LABELS",
    "VALID_RATINGS",
    "get_completion_summary",
    "get_palace_mastery_trend",
    "get_palace_memory_projection",
    "list_due_nodes",
    "rate_nodes",
    "undo_rating_operation",
]


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _schedule_settings(session: Session | None = None) -> tuple[float, int, int]:
    settings = load_fsrs_settings(session)
    return (
        float(settings["desired_retention"]),
        int(settings["maximum_interval"]),
        int(settings["mastery_horizon_days"]),
    )


def _scheduler(
    session: Session | None = None,
    retention: float | None = None,
    maximum_interval: int | None = None,
):
    return build_scheduler(
        session, retention=retention, maximum_interval=maximum_interval
    )


def _node_uid(raw: dict[str, Any], fallback: str) -> str:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    return str(data.get("uid") or data.get("memoryAnkiId") or fallback).strip()


def _node_text(raw: dict[str, Any]) -> str:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    return str(data.get("text") or "").strip()


def _content_fingerprint(raw: dict[str, Any]) -> str:
    value = raw.get("data")
    data: dict[str, Any] = value if isinstance(value, dict) else {}
    payload = {"text": data.get("text", ""), "note": data.get("note", "")}
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def _tree(palace: Palace) -> tuple[str | None, dict[str, dict[str, Any]]]:
    try:
        document = json.loads(palace.editor_doc or "{}")
    except (TypeError, ValueError):
        return None, {}
    root = document.get("root") if isinstance(document, dict) else None
    if not isinstance(root, dict):
        return None, {}
    result: dict[str, dict[str, Any]] = {}

    def walk(raw: dict[str, Any], parent_uid: str | None, fallback: str) -> str:
        uid = _node_uid(raw, fallback)
        value = raw.get("children")
        children_raw: list[Any] = value if isinstance(value, list) else []
        children = [
            walk(child, uid, f"{fallback}-{index}")
            for index, child in enumerate(children_raw)
            if isinstance(child, dict)
        ]
        result[uid] = {
            "uid": uid,
            "parent_uid": parent_uid,
            "children": children,
            "text": _node_text(raw),
            "content_fingerprint": _content_fingerprint(raw),
        }
        return uid

    root_uid = walk(root, None, "root")
    return root_uid, result


def _top_level_branch_uid(
    nodes: dict[str, dict[str, Any]], root_uid: str | None, node_uid: str
) -> str | None:
    if root_uid is None or node_uid == root_uid:
        return None
    current = node_uid
    while current and current in nodes:
        parent = nodes[current].get("parent_uid")
        if parent == root_uid:
            return current
        if parent is None:
            return current if current != root_uid else None
        current = parent
    return None


def _entry_mode_payload(
    *,
    root_uid: str | None,
    nodes: dict[str, dict[str, Any]],
    due_items: list[dict[str, Any]],
) -> dict[str, Any]:
    due_uids = [item["node_uid"] for item in due_items]
    branch_uids: list[str] = []
    seen: set[str] = set()
    for uid in due_uids:
        branch = _top_level_branch_uid(nodes, root_uid, uid)
        if branch and branch not in seen:
            seen.add(branch)
            branch_uids.append(branch)
    count = len(due_uids)
    if count == 0:
        return {
            "review_entry_mode": "none",
            "review_entry_label": None,
            "primary_branch_uid": None,
            "primary_branch_title": None,
            "due_branch_count": 0,
            "due_node_uids": [],
        }
    if len(branch_uids) == 1:
        branch_uid = branch_uids[0]
        title = str(nodes.get(branch_uid, {}).get("text") or "未命名节点").strip() or "未命名节点"
        return {
            "review_entry_mode": "node",
            "review_entry_label": f"节点复习 · {count}",
            "primary_branch_uid": branch_uid,
            "primary_branch_title": title,
            "due_branch_count": 1,
            "due_node_uids": due_uids,
        }
    return {
        "review_entry_mode": "palace",
        "review_entry_label": f"开始复习 · {count}",
        "primary_branch_uid": None,
        "primary_branch_title": None,
        "due_branch_count": len(branch_uids),
        "due_node_uids": due_uids,
    }


def _descendants(nodes: dict[str, dict[str, Any]], uid: str) -> list[str]:
    result: list[str] = []
    stack = list(nodes.get(uid, {}).get("children", []))
    while stack:
        current = stack.pop(0)
        result.append(current)
        stack[0:0] = list(nodes.get(current, {}).get("children", []))
    return result


def _card_from_state(state: ReviewNodeState | None, *, card_id: int) -> Card:
    if state is None:
        return Card(card_id=card_id, state=State.Learning, due=_utc_now())
    return Card(
        card_id=card_id,
        state=State(state.state),
        step=state.step,
        stability=state.stability,
        difficulty=state.difficulty,
        due=_aware(state.due_at) or _utc_now(),
        last_review=_aware(state.last_review_at),
    )


def _card_dict(card: Card) -> dict[str, Any]:
    return cast(dict[str, Any], card.to_dict())


def _state_dict(state: ReviewNodeState | None) -> dict[str, Any] | None:
    if state is None:
        return None
    return {
        "state": state.state,
        "step": state.step,
        "stability": state.stability,
        "difficulty": state.difficulty,
        "due_at": state.due_at.isoformat(),
        "last_review_at": state.last_review_at.isoformat() if state.last_review_at else None,
        "desired_retention": state.desired_retention,
        "maximum_interval": state.maximum_interval,
        "content_fingerprint": state.content_fingerprint,
        "state_source": state.state_source,
        "scheduler_version": state.scheduler_version,
        "parameter_version": state.parameter_version,
    }


def _restore_state(
    session: Session, palace_id: int, node_uid: str, snapshot: dict[str, Any] | None
) -> None:
    row = session.query(ReviewNodeState).filter_by(palace_id=palace_id, node_uid=node_uid).first()
    if snapshot is None:
        if row is not None:
            session.delete(row)
        return
    if row is None:
        row = ReviewNodeState(palace_id=palace_id, node_uid=node_uid)
        session.add(row)
    row.state = int(snapshot["state"])
    row.step = snapshot.get("step")
    row.stability = snapshot.get("stability")
    row.difficulty = snapshot.get("difficulty")
    row.due_at = datetime.fromisoformat(snapshot["due_at"])
    row.last_review_at = (
        datetime.fromisoformat(snapshot["last_review_at"])
        if snapshot.get("last_review_at")
        else None
    )
    row.desired_retention = float(snapshot.get("desired_retention", DEFAULT_RETENTION))
    row.maximum_interval = int(snapshot.get("maximum_interval", DEFAULT_MAXIMUM_INTERVAL))
    row.content_fingerprint = str(snapshot.get("content_fingerprint") or "")
    row.state_source = str(snapshot.get("state_source") or "manual")
    row.scheduler_version = str(snapshot.get("scheduler_version") or SCHEDULER_VERSION)
    row.parameter_version = str(snapshot.get("parameter_version") or PARAMETER_VERSION)


def _apply_card(
    row: ReviewNodeState, card: Card, *, fingerprint: str, source: str = "manual"
) -> None:
    row.state = int(card.state)
    row.step = card.step
    row.stability = card.stability
    row.difficulty = card.difficulty
    row.due_at = _naive(card.due) or utc_now_naive()
    row.last_review_at = _naive(card.last_review)
    row.desired_retention = DEFAULT_RETENTION
    row.maximum_interval = DEFAULT_MAXIMUM_INTERVAL
    row.content_fingerprint = fingerprint
    row.state_source = source
    row.scheduler_version = SCHEDULER_VERSION
    row.parameter_version = PARAMETER_VERSION
    row.updated_at = utc_now_naive()


def _card_id(palace_id: int, node_uid: str) -> int:
    return int(hashlib.sha256(f"{palace_id}:{node_uid}".encode()).hexdigest()[:15], 16)


def _event_id(operation_id: str, node_uid: str) -> str:
    return hashlib.sha256(f"{operation_id}:{node_uid}".encode()).hexdigest()[:64]


def _latest_rating(session: Session, palace_id: int, node_uid: str) -> int | None:
    rows = (
        session.query(MindMapRecallEvent)
        .filter_by(palace_id=palace_id, node_uid=node_uid)
        .order_by(MindMapRecallEvent.occurred_at.desc(), MindMapRecallEvent.created_at.desc())
        .limit(20)
        .all()
    )
    undone_ids = {
        item.id
        for item in session.query(ReviewRatingOperation)
        .filter(ReviewRatingOperation.undone_at.is_not(None))
        .all()
    }
    for row in rows:
        if row.operation_id and row.operation_id in undone_ids:
            continue
        return 3 if row.rating == 5 else row.rating
    return None


def _session_direct_rated_uids(
    session: Session,
    *,
    study_session_id: str,
    palace_id: int,
    recall_round: str,
) -> set[str]:
    """Nodes whose latest non-undone event in this session/round is a direct rating."""
    rows = (
        session.query(MindMapRecallEvent)
        .filter_by(
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        )
        .order_by(MindMapRecallEvent.occurred_at.desc(), MindMapRecallEvent.created_at.desc())
        .all()
    )
    if not rows:
        return set()
    undone_ids = {
        item.id
        for item in session.query(ReviewRatingOperation)
        .filter(
            ReviewRatingOperation.study_session_id == study_session_id,
            ReviewRatingOperation.undone_at.is_not(None),
        )
        .all()
    }
    latest_by_node: dict[str, MindMapRecallEvent] = {}
    for row in rows:
        if row.operation_id and row.operation_id in undone_ids:
            continue
        if row.node_uid in latest_by_node:
            continue
        latest_by_node[row.node_uid] = row
    return {
        uid
        for uid, event in latest_by_node.items()
        if event.evidence_origin == "direct"
    }


def _projection(session: Session, palace: Palace, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or _utc_now()
    root_uid, nodes = _tree(palace)
    valid_uids = [uid for uid in nodes if uid != root_uid]
    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState).filter_by(palace_id=palace.id).all()
    }
    scheduler = _scheduler(session)
    details: list[dict[str, Any]] = []
    for uid in valid_uids:
        row = states.get(uid)
        due_at: datetime | None
        if row and row.content_fingerprint != nodes[uid]["content_fingerprint"]:
            stability = 0.0
            retrievability = 0.0
            due_at = now
            state_source = "content_reset_pending"
        else:
            card = _card_from_state(row, card_id=_card_id(palace.id, uid))
            stability = float(card.stability or 0.0)
            retrievability = (
                scheduler.get_card_retrievability(card, current_datetime=now)
                if row and row.last_review_at
                else 0.0
            )
            due_at = _aware(row.due_at) if row else now
            state_source = row.state_source if row else "new"
        branch_uid = _top_level_branch_uid(nodes, root_uid, uid)
        details.append(
            {
                "node_uid": uid,
                "text": nodes[uid].get("text") or "",
                "branch_uid": branch_uid,
                "stability_days": round(stability, 3),
                "retrievability": round(max(0.0, min(retrievability, 1.0)), 4),
                "due_at": due_at.isoformat() if due_at else None,
                "due": bool(due_at and due_at <= now),
                "state_source": state_source,
                "rating": _latest_rating(session, palace.id, uid),
            }
        )
    total = len(details)
    _, _, mastery_horizon_days = _schedule_settings(session)
    mastery_progress = (
        (sum(min(item["stability_days"] / mastery_horizon_days, 1.0) for item in details) / total)
        if total
        else 0.0
    )
    memory_health = (sum(item["retrievability"] for item in details) / total) if total else 0.0
    due_items = [item for item in details if item["due"]]
    severe = sum(1 for item in details if item["rating"] == 1)
    mastered_count = sum(1 for item in details if item["stability_days"] >= mastery_horizon_days)
    next_due = min((item["due_at"] for item in details if item["due_at"]), default=None)
    entry = _entry_mode_payload(root_uid=root_uid, nodes=nodes, due_items=due_items)
    return {
        "palace_id": palace.id,
        "node_count": total,
        "mastery_progress": round(mastery_progress, 4),
        "mastery_percent": round(mastery_progress * 100),
        "memory_health": round(memory_health, 4),
        "memory_health_percent": round(memory_health * 100),
        "mastered_node_count": mastered_count,
        "mastery_horizon_days": mastery_horizon_days,
        "due_node_count": len(due_items),
        "overdue_node_count": sum(
            1 for item in due_items if item["due_at"] and item["due_at"] < now.isoformat()
        ),
        "next_review_at": next_due,
        "mastered": total > 0 and mastered_count / total >= 0.9 and severe == 0,
        "severe_weak_node_count": severe,
        "has_due_review": len(due_items) > 0,
        **entry,
        "nodes": details,
    }


def due_node_uids_for_entry(
    session: Session,
    palace_id: int,
    *,
    entry_mode: str | None = None,
    branch_uid: str | None = None,
) -> list[str]:
    """Resolve frozen due UIDs for formal review entry (palace or single top-level branch)."""
    projection = get_palace_memory_projection(session, palace_id)
    mode = entry_mode or projection.get("review_entry_mode") or "none"
    if mode == "none" or not projection.get("due_node_uids"):
        return []
    if mode == "node":
        target_branch = branch_uid or projection.get("primary_branch_uid")
        if not target_branch:
            return list(projection["due_node_uids"])
        return [
            item["node_uid"]
            for item in projection["nodes"]
            if item.get("due") and item.get("branch_uid") == target_branch
        ]
    return list(projection["due_node_uids"])


def get_palace_memory_projection(session: Session, palace_id: int) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    return _projection(session, palace)


def get_palace_mastery_trend(session: Session, palace_id: int) -> dict[str, Any]:
    """Return one mastery snapshot for each completed formal FSRS review."""
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")

    rows = (
        session.query(StudySession)
        .filter(
            StudySession.palace_id == palace_id,
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.ended_at.is_not(None),
        )
        .order_by(StudySession.ended_at.asc(), StudySession.id.asc())
        .all()
    )
    points: list[dict[str, Any]] = []
    for row in rows:
        try:
            summary = json.loads(row.summary_json or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        receipt = summary.get("completion_receipt")
        if not isinstance(receipt, dict):
            continue
        mastery_progress = receipt.get("mastery_progress")
        mastery_percent = receipt.get("mastery_percent")
        ended_at = row.ended_at
        if (
            ended_at is None
            or not isinstance(mastery_progress, int | float)
            or not isinstance(mastery_percent, int | float)
        ):
            continue
        points.append(
            {
                "at": ended_at.isoformat(),
                "mastery_progress": round(float(mastery_progress), 4),
                "mastery_percent": round(float(mastery_percent)),
            }
        )
    return {"palace_id": palace_id, "points": points}


def rate_nodes(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    rating: int,
    study_session_id: str,
    operation_id: str,
    rating_scope: str = "subtree",
    conflict_policy: str = "overwrite",
    source_scene: str = "formal_review",
    recall_round: str = "first",
    rating_source: str = "manual",
    inference_confidence: float | None = None,
    response_ms: int | None = None,
    hint_count: int = 0,
    retry_count: int = 0,
) -> dict[str, Any]:
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be between 1 and 4")
    if rating_scope not in {"single", "subtree"}:
        raise ValueError("rating_scope must be single or subtree")
    if conflict_policy not in {"overwrite", "skip_direct"}:
        raise ValueError("conflict_policy must be overwrite or skip_direct")
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    existing = session.get(ReviewRatingOperation, operation_id)
    if existing is not None:
        if (
            existing.study_session_id != study_session_id
            or existing.palace_id != palace_id
            or existing.root_node_uid != node_uid
            or existing.rating != rating
            or existing.rating_scope != rating_scope
        ):
            raise ValueError("rating operation belongs to another request")
        return {
            "operation_id": operation_id,
            "affected_node_count": existing.affected_node_count,
            "idempotent": True,
            **_projection(session, palace),
        }
    root_uid, nodes = _tree(palace)
    if node_uid not in nodes:
        raise ValueError("node not found")
    selected = (
        [node_uid] if rating_scope == "single" else [node_uid, *_descendants(nodes, node_uid)]
    )
    selected = [uid for uid in selected if uid != root_uid]
    if source_scene == "formal_review" and (
        study_session_id.startswith("review-")
        or session.get(StudySession, study_session_id) is not None
    ):
        from memory_anki.modules.reviews.application.formal_review_service import (
            get_formal_review_scope,
        )

        selected = [
            uid
            for uid in selected
            if uid in get_formal_review_scope(session, study_session_id, palace_id)
        ]
    if conflict_policy == "skip_direct" and rating_scope == "subtree":
        direct_uids = _session_direct_rated_uids(
            session,
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        )
        # Always re-rate the target node; only skip descendants with direct ratings.
        selected = [uid for uid in selected if uid == node_uid or uid not in direct_uids]
    if not selected:
        if node_uid == root_uid:
            raise ValueError("root node cannot be scheduled alone; rate descendants or expand scope")
        raise ValueError("没有可评分节点（可能不在本次复习范围，或子节点均已单独评分并选择避开）")
    operation = ReviewRatingOperation(
        id=operation_id,
        study_session_id=study_session_id,
        palace_id=palace_id,
        root_node_uid=node_uid,
        rating=rating,
        rating_scope=rating_scope,
        affected_node_count=len(selected),
    )
    session.add(operation)
    before_projection = _projection(session, palace)
    scheduler = _scheduler(session)
    for uid in selected:
        row = session.query(ReviewNodeState).filter_by(palace_id=palace_id, node_uid=uid).first()
        before = _state_dict(row)
        before_rating = _latest_rating(session, palace_id, uid)
        fingerprint = nodes[uid]["content_fingerprint"]
        # Content edit invalidates prior schedule, but the unique key is still
        # (palace_id, node_uid). Keep the existing row and start a fresh card
        # instead of INSERT (which raised IntegrityError → HTTP 500).
        schedule_row = (
            row if row is not None and row.content_fingerprint == fingerprint else None
        )
        card = _card_from_state(schedule_row, card_id=_card_id(palace_id, uid))
        card, _log = scheduler.review_card(card, Rating(rating), review_datetime=_utc_now())
        if row is None:
            row = ReviewNodeState(palace_id=palace_id, node_uid=uid)
            session.add(row)
        _apply_card(row, card, fingerprint=fingerprint, source="manual")
        event_id = _event_id(operation_id, uid)
        session.add(
            MindMapRecallEvent(
                id=event_id,
                study_session_id=study_session_id,
                palace_id=palace_id,
                node_uid=uid,
                source_scene=source_scene,
                recall_round=recall_round,
                rating=rating,
                rating_source=rating_source,
                rating_scope=rating_scope,
                evidence_origin="direct" if uid == node_uid else "batch_inherited",
                inference_confidence=inference_confidence,
                operation_id=operation_id,
                response_ms=response_ms,
                hint_count=max(0, hint_count),
                retry_count=max(0, retry_count),
            )
        )
        session.add(
            ReviewRatingOperationItem(
                operation_id=operation_id,
                palace_id=palace_id,
                node_uid=uid,
                event_id=event_id,
                before_state_json=json.dumps(before, ensure_ascii=False) if before else None,
                after_state_json=json.dumps(_state_dict(row), ensure_ascii=False),
                before_rating=before_rating,
            )
        )
    session.flush()
    after_projection = _projection(session, palace)
    session.commit()
    return {
        "operation_id": operation_id,
        "affected_node_count": len(selected),
        "affected_node_uids": selected,
        "previous_mastery_progress": before_projection["mastery_progress"],
        "current_mastery_progress": after_projection["mastery_progress"],
        "previous_memory_health": before_projection["memory_health"],
        "current_memory_health": after_projection["memory_health"],
        "next_review_at": after_projection["next_review_at"],
        "due_node_count": after_projection["due_node_count"],
        "undo_available": True,
        **after_projection,
    }


def undo_rating_operation(
    session: Session, *, operation_id: str, study_session_id: str
) -> dict[str, Any]:
    operation = session.get(ReviewRatingOperation, operation_id)
    if operation is None:
        raise ValueError("rating operation not found")
    if operation.study_session_id != study_session_id:
        raise ValueError("rating operation belongs to another session")
    if operation.undone_at is not None:
        return {"operation_id": operation_id, "undone": True, "idempotent": True}
    newer = (
        session.query(ReviewRatingOperation)
        .filter(
            ReviewRatingOperation.study_session_id == study_session_id,
            ReviewRatingOperation.created_at > operation.created_at,
            ReviewRatingOperation.undone_at.is_(None),
        )
        .first()
    )
    if newer is not None:
        raise ValueError("only the latest rating operation can be undone")
    palace = session.get(Palace, operation.palace_id)
    if palace is None:
        raise ValueError("palace not found")
    before = _projection(session, palace)
    items = session.query(ReviewRatingOperationItem).filter_by(operation_id=operation_id).all()
    for item in items:
        snapshot = json.loads(item.before_state_json) if item.before_state_json else None
        _restore_state(session, operation.palace_id, item.node_uid, snapshot)
    operation.undone_at = utc_now_naive()
    session.flush()
    after = _projection(session, palace)
    session.commit()
    return {
        "operation_id": operation_id,
        "undone": True,
        "affected_node_count": len(items),
        "previous_mastery_progress": before["mastery_progress"],
        "current_mastery_progress": after["mastery_progress"],
        **after,
    }


def get_completion_summary(
    session: Session, palace_id: int, *, node_uids: list[str] | None = None
) -> dict[str, Any]:
    projection = get_palace_memory_projection(session, palace_id)
    selected = set(node_uids or [item["node_uid"] for item in projection["nodes"]])
    scoped = [item for item in projection["nodes"] if item["node_uid"] in selected]
    rated = [item for item in scoped if item["rating"] in VALID_RATINGS]
    rating_counts = {label: 0 for label in RATING_LABELS.values()}
    for item in rated:
        rating_counts[RATING_LABELS[item["rating"]]] += 1
    return {
        "palace_id": palace_id,
        "scope_node_count": len(scoped),
        "rated_node_count": len(rated),
        "unrated_due_node_count": sum(
            1 for item in scoped if item["due"] and item["rating"] is None
        ),
        "rating_counts": rating_counts,
        "mastery_progress": projection["mastery_progress"],
        "memory_health": projection["memory_health"],
        "next_review_at": projection["next_review_at"],
        "due_node_count": projection["due_node_count"],
        "projection": projection,
    }


def list_due_nodes(session: Session, palace_id: int, *, now: datetime | None = None) -> list[str]:
    projection = get_palace_memory_projection(session, palace_id)
    return [item["node_uid"] for item in projection["nodes"] if item["due"]]
