"""Node-level FSRS memory projections and tree/state helpers.

Read models and shared helpers used by rating mutations. Keeps the rating
service thin so the architecture size gate stays under limit.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, cast

from fsrs import Card, State
from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
)
from memory_anki.modules.reviews.application.fsrs_runtime import (
    DEFAULT_MAXIMUM_INTERVAL,
    DEFAULT_RETENTION,
    FORMAL_ENTRY_NEAR_DUE_LOOKAHEAD,
    PARAMETER_VERSION,
    RATING_LABELS,
    SCHEDULER_VERSION,
    VALID_RATINGS,
    build_scheduler,
    load_fsrs_settings,
)
from memory_anki.modules.reviews.application.node_entry_projection import (
    branch_review_summaries as _branch_review_summaries,
)
from memory_anki.modules.reviews.application.node_entry_projection import (
    entry_mode_payload as _entry_mode_payload,
)
from memory_anki.modules.reviews.application.node_entry_projection import (
    top_level_branch_uid as _top_level_branch_uid,
)

# Re-export for existing imports/tests.


__all__ = [
    "RATING_LABELS",
    "VALID_RATINGS",
    "due_node_uids_for_entry",
    "get_completion_summary",
    "get_palace_due_rollup",
    "get_palace_mastery_trend",
    "get_palace_memory_projection",
    "list_due_nodes",
    "_apply_card",
    "_card_from_state",
    "_card_id",
    "_clear_due_rollup_cache",
    "_descendants",
    "_event_id",
    "_latest_ratings_for_palace",
    "_load_palace_node_states",
    "_naive",
    "_rating_mutation_projection",
    "_restore_state",
    "_scheduler",
    "_session_rated_uids",
    "_state_dict",
    "_tree",
    "_utc_now",
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


def _undone_operation_ids(session: Session, *, palace_id: int | None = None) -> set[str]:
    query = session.query(ReviewRatingOperation.id).filter(
        ReviewRatingOperation.undone_at.is_not(None)
    )
    if palace_id is not None:
        query = query.filter(ReviewRatingOperation.palace_id == palace_id)
    return {str(item[0]) for item in query.all()}


def _latest_ratings_for_palace(
    session: Session, palace_id: int, node_uids: list[str] | set[str]
) -> dict[str, int | None]:
    """Batch latest non-undone rating per node for one palace (avoids per-node N+1)."""
    wanted = set(node_uids)
    if not wanted:
        return {}
    undone_ids = _undone_operation_ids(session, palace_id=palace_id)
    rows = (
        session.query(MindMapRecallEvent)
        .filter(
            MindMapRecallEvent.palace_id == palace_id,
            MindMapRecallEvent.node_uid.in_(wanted),
        )
        .order_by(
            MindMapRecallEvent.node_uid.asc(),
            MindMapRecallEvent.occurred_at.desc(),
            MindMapRecallEvent.created_at.desc(),
        )
        .all()
    )
    latest: dict[str, int | None] = {uid: None for uid in wanted}
    for row in rows:
        if row.node_uid not in wanted:
            continue
        if latest[row.node_uid] is not None:
            continue
        if row.operation_id and row.operation_id in undone_ids:
            continue
        latest[row.node_uid] = 3 if row.rating == 5 else int(row.rating)
    return latest


def _latest_rating(session: Session, palace_id: int, node_uid: str) -> int | None:
    return _latest_ratings_for_palace(session, palace_id, [node_uid]).get(node_uid)


def _session_latest_events_by_node(
    session: Session,
    *,
    study_session_id: str,
    palace_id: int,
    recall_round: str,
) -> dict[str, MindMapRecallEvent]:
    """Latest non-undone MindMapRecallEvent per node for this session/round."""
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
        return {}
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
    return latest_by_node


def _session_rated_uids(
    session: Session,
    *,
    study_session_id: str,
    palace_id: int,
    recall_round: str,
) -> set[str]:
    """Nodes with a latest non-undone rating in this session/round (any evidence_origin).

    Used by conflict_policy=skip_direct ("避开"): skip every descendant that already
    has a score, including batch_inherited grandchildren from a prior child subtree
    rating — not only nodes whose latest event is evidence_origin=direct.
    """
    return set(
        _session_latest_events_by_node(
            session,
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        ).keys()
    )


def _load_palace_node_states(
    session: Session, palace_id: int
) -> dict[str, ReviewNodeState]:
    from memory_anki.modules.reviews.application.node_due_rollup_batch import (
        load_palace_node_states_for_ids,
    )

    return load_palace_node_states_for_ids(session, [palace_id]).get(int(palace_id), {})


def _projection_from_tree(
    session: Session,
    palace: Palace,
    *,
    root_uid: str | None,
    nodes: dict[str, dict[str, Any]],
    states: dict[str, ReviewNodeState],
    now: datetime | None = None,
    include_ratings: bool = True,
    include_nodes: bool = True,
    ratings: dict[str, int | None] | None = None,
    scheduler: Any | None = None,
    mastery_horizon_days: int | None = None,
) -> dict[str, Any]:
    """Build memory projection from an already-parsed tree and in-memory states.

    Rating/undo hot paths call this with ``include_ratings=False`` and
    ``include_nodes=False`` so a single score does not re-scan history or
    serialize every node detail twice.

    Batch list paths may pass a shared ``scheduler`` and ``mastery_horizon_days``
    so FSRS settings are loaded once per request instead of once per palace.
    """
    # FSRS subtracts current_datetime - card.last_review; both must be tz-aware UTC.
    now = _aware(now) or _utc_now()
    valid_uids = [uid for uid in nodes if uid != root_uid]
    active_scheduler = scheduler if scheduler is not None else _scheduler(session)
    if include_ratings:
        resolved_ratings = (
            ratings
            if ratings is not None
            else _latest_ratings_for_palace(session, palace.id, valid_uids)
        )
    else:
        resolved_ratings = {}
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
                active_scheduler.get_card_retrievability(card, current_datetime=now)
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
                "due_at": to_api_datetime(due_at) if due_at else None,
                "due": bool(due_at and due_at <= now),
                "state_source": state_source,
                "rating": resolved_ratings.get(uid) if include_ratings else None,
            }
        )
    total = len(details)
    if mastery_horizon_days is None:
        _, _, mastery_horizon_days = _schedule_settings(session)
    mastery_horizon = int(mastery_horizon_days)
    mastery_progress = (
        (sum(min(item["stability_days"] / mastery_horizon, 1.0) for item in details) / total)
        if total
        else 0.0
    )
    memory_health = (sum(item["retrievability"] for item in details) / total) if total else 0.0
    due_items = [item for item in details if item["due"]]
    severe = sum(1 for item in details if item["rating"] == 1) if include_ratings else 0
    mastered_count = sum(1 for item in details if item["stability_days"] >= mastery_horizon)
    next_due = min((item["due_at"] for item in details if item["due_at"]), default=None)
    entry = _entry_mode_payload(root_uid=root_uid, nodes=nodes, due_items=due_items)
    branch_summaries = (
        _branch_review_summaries(root_uid=root_uid, nodes=nodes, details=details, now=now)
        if include_nodes
        else []
    )
    return {
        "palace_id": palace.id,
        "node_count": total,
        "mastery_progress": round(mastery_progress, 4),
        "mastery_percent": round(mastery_progress * 100),
        "memory_health": round(memory_health, 4),
        "memory_health_percent": round(memory_health * 100),
        "mastered_node_count": mastered_count,
        "mastery_horizon_days": mastery_horizon,
        "due_node_count": len(due_items),
        "overdue_node_count": sum(
            1 for item in due_items if item["due_at"] and item["due_at"] < now.isoformat()
        ),
        "next_review_at": next_due,
        "mastered": total > 0 and mastered_count / total >= 0.9 and severe == 0,
        "severe_weak_node_count": severe,
        "has_due_review": len(due_items) > 0,
        **entry,
        "review_branch_summaries": branch_summaries,
        "nodes": details if include_nodes else [],
    }


def _projection(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
    include_ratings: bool = True,
    include_nodes: bool = True,
) -> dict[str, Any]:
    root_uid, nodes = _tree(palace)
    states = _load_palace_node_states(session, palace.id)
    return _projection_from_tree(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=now,
        include_ratings=include_ratings,
        include_nodes=include_nodes,
    )


def _rating_mutation_projection(
    session: Session,
    palace: Palace,
    *,
    root_uid: str | None,
    nodes: dict[str, dict[str, Any]],
    states: dict[str, ReviewNodeState],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Slim projection for rate/undo responses (no per-node ratings or nodes[])."""
    return _projection_from_tree(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=now,
        include_ratings=False,
        include_nodes=False,
    )


def due_node_uids_for_entry(
    session: Session,
    palace_id: int,
    *,
    entry_mode: str | None = None,
    branch_uid: str | None = None,
) -> list[str]:
    """Resolve frozen due UIDs for formal review entry (palace or single top-level branch).

    Includes cards already due and those that become due within
    ``FORMAL_ENTRY_NEAR_DUE_LOOKAHEAD`` so short relearning/weak windows that
    expire mid-session still enter the same frozen scope.
    """
    now = _utc_now()
    horizon = now + FORMAL_ENTRY_NEAR_DUE_LOOKAHEAD
    projection = get_palace_memory_projection(session, palace_id, now=now)
    mode = entry_mode or projection.get("review_entry_mode") or "none"
    if mode == "none":
        return []

    def _in_entry_wave(item: dict[str, Any]) -> bool:
        if item.get("due"):
            return True
        raw = item.get("due_at")
        if not raw:
            return False
        try:
            due_at = _aware(datetime.fromisoformat(str(raw)))
        except ValueError:
            return False
        return bool(due_at and due_at <= horizon)

    wave = [item for item in projection.get("nodes") or [] if _in_entry_wave(item)]
    if not wave:
        return []
    if mode == "node":
        target_branch = branch_uid or projection.get("primary_branch_uid")
        if target_branch:
            scoped = [
                item["node_uid"]
                for item in wave
                if item.get("branch_uid") == target_branch
            ]
            if scoped:
                return scoped
    return [item["node_uid"] for item in wave]


def get_palace_memory_projection(
    session: Session,
    palace_id: int,
    *,
    include_ratings: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    return _projection(
        session,
        palace,
        now=now,
        include_ratings=include_ratings,
    )


def _clear_due_rollup_cache(session: Session) -> None:
    session.info.pop("_palace_due_rollup_cache", None)


def get_palace_due_rollup(
    session: Session,
    palace_id: int,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Lightweight due/mastery rollup for catalog/queue list paths (no per-node ratings)."""
    from memory_anki.modules.reviews.application.node_due_rollup_batch import (
        project_due_rollups_batch,
    )

    cache = session.info.setdefault("_palace_due_rollup_cache", {})
    # Only cache the default "now" path so list endpoints can share work in one request.
    if now is None and palace_id in cache:
        return dict(cache[palace_id])

    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    batch = project_due_rollups_batch(
        session,
        [palace],
        now=now,
        include_nodes=True,
    )
    return dict(batch[int(palace_id)])


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


