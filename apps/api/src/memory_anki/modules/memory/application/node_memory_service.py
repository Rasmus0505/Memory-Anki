"""Node-level FSRS rating mutations (rate / undo / session finalize)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fsrs import Rating
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
    ReviewWave,
)
from memory_anki.modules.memory.application.fsrs_runtime import (
    RATING_LABELS,
    VALID_RATINGS,
)
from memory_anki.modules.memory.application.node_due_rollup_batch import (
    project_due_rollups_batch,
)
from memory_anki.modules.memory.application.node_memory_batch_rating import (
    rate_nodes_batch_single,
)
from memory_anki.modules.memory.application.node_memory_projection import (
    _apply_card,
    _card_from_state,
    _card_id,
    _clear_due_rollup_cache,
    _descendants,
    _event_id,
    _latest_ratings_for_palace,
    _load_palace_node_states,
    _naive,
    _rating_mutation_projection,
    _scheduler,
    _session_rated_uids,
    _state_dict,
    _tree,
    _utc_now,
    get_palace_due_rollup,
    get_palace_memory_projection,
)
from memory_anki.modules.memory.application.node_rating_undo import (
    finalize_formal_review_schedules,
    undo_rating_operation,
)

# Public re-exports keep existing import paths stable.
__all__ = [
    "RATING_LABELS",
    "VALID_RATINGS",
    "due_node_uids_for_entry",
    "finalize_formal_review_schedules",
    "get_completion_summary",
    "get_palace_due_rollup",
    "get_palace_mastery_trend",
    "get_palace_memory_projection",
    "list_due_nodes",
    "project_due_rollups_batch",
    "rate_nodes",
    "rate_nodes_batch_single",
    "undo_rating_operation",
]


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


def _progress_scopes_from_flags(
    *,
    include_reinforcement: bool,
    include_calendar_today_due: bool,
    progress_scopes: list[str] | set[str] | tuple[str, ...] | None,
) -> set[str]:
    """Resolve freestyle progress scopes from explicit list or legacy flags.

    When ``progress_scopes`` is provided (including empty), it is authoritative.
    Otherwise map legacy booleans onto the default formal+optional set:
    formal due buckets always on; reinforcement / calendar_today from flags.
    """
    from memory_anki.modules.memory.application.wave_policy import (
        DEFAULT_PROGRESS_SCOPES,
        PROGRESS_SCOPE_CALENDAR_TODAY,
        PROGRESS_SCOPE_DUE,
        PROGRESS_SCOPE_NEW,
        PROGRESS_SCOPE_OVERDUE,
        PROGRESS_SCOPE_REINFORCEMENT,
        PROGRESS_SCOPES,
    )

    if progress_scopes is not None:
        selected = {str(item) for item in progress_scopes if str(item) in PROGRESS_SCOPES}
        return selected if selected else set(DEFAULT_PROGRESS_SCOPES)

    scopes = {
        PROGRESS_SCOPE_OVERDUE,
        PROGRESS_SCOPE_DUE,
        PROGRESS_SCOPE_NEW,
    }
    if include_reinforcement:
        scopes.add(PROGRESS_SCOPE_REINFORCEMENT)
    if include_calendar_today_due:
        scopes.add(PROGRESS_SCOPE_CALENDAR_TODAY)
    return scopes


def _node_matches_progress_scopes(item: dict, scopes: set[str]) -> bool:
    bucket = item.get("progress_bucket")
    if bucket and bucket in scopes:
        return True
    # Legacy projections without progress_bucket: approximate from flags.
    if not bucket:
        if item.get("due") and (
            "overdue" in scopes or "due" in scopes or "new" in scopes
        ):
            return True
        if item.get("reinforcement_due") and "reinforcement" in scopes:
            return True
        if item.get("calendar_today_due") and "calendar_today" in scopes:
            return True
    return False


def list_due_nodes(
    session: Session,
    palace_id: int,
    *,
    now: datetime | None = None,
    include_reinforcement: bool = False,
    include_calendar_today_due: bool = False,
    progress_scopes: list[str] | set[str] | tuple[str, ...] | None = None,
) -> list[str]:
    """List currently actionable node UIDs for a palace.

    Prefer ``progress_scopes`` (overdue / due / calendar_today / reinforcement /
    new). Legacy flags still work when scopes are omitted:

    - default formal: overdue + due + new (via ``due`` flag)
    - ``include_reinforcement``: same-day weak-rating restudy
    - ``include_calendar_today_due``: formal nodes due later today (local day)
    """
    del now  # projection uses current time; kept for call-site compatibility
    scopes = _progress_scopes_from_flags(
        include_reinforcement=include_reinforcement,
        include_calendar_today_due=include_calendar_today_due,
        progress_scopes=progress_scopes,
    )
    projection = get_palace_memory_projection(session, palace_id)
    result: list[str] = []
    for item in projection["nodes"]:
        if _node_matches_progress_scopes(item, scopes):
            result.append(item["node_uid"])
    return result


def due_node_uids_for_entry(
    session: Session,
    palace_id: int,
    *,
    entry_mode: str | None = None,
    branch_uid: str | None = None,
    scope_node_uids: list[str] | None = None,
    unit_root_uid: str | None = None,
    progress_scopes: list[str] | set[str] | tuple[str, ...] | None = None,
) -> list[str]:
    """Freeze actionable UIDs; freestyle scope follows progress_scopes when set.

    Without progress_scopes and with an explicit unit scope, allow reinforcement
    + calendar-today so card due_node_uids can still be rated after open.
    """
    from memory_anki.modules.memory.application.wave_policy import (
        DEFAULT_PROGRESS_SCOPES,
        PROGRESS_SCOPE_CALENDAR_TODAY,
        PROGRESS_SCOPE_REINFORCEMENT,
        PROGRESS_SCOPES,
    )

    # 单元入口：把单元的文档先序节点集当作 scope 走既有分支——该分支的语义
    # 正是"与 due 求交"，恰好等于"只刷到期卡"，且保留传入顺序 → 复习顺序
    # 自动是根→一级分支从上到下→分支内深度优先。
    if scope_node_uids is None and unit_root_uid is not None:
        from memory_anki.modules.memory.application.scheduling.units import resolve_units

        unit = resolve_units(session, palace_id).get(unit_root_uid)
        if unit is not None:
            scope_node_uids = list(unit.order)

    projection = get_palace_memory_projection(session, palace_id, now=_utc_now())
    mode = entry_mode or projection.get("review_entry_mode") or "none"
    if mode == "none" and not scope_node_uids:
        return []

    if progress_scopes is not None:
        scopes = {
            str(item) for item in progress_scopes if str(item) in PROGRESS_SCOPES
        } or set(DEFAULT_PROGRESS_SCOPES)
        wave = [
            item
            for item in projection.get("nodes") or []
            if _node_matches_progress_scopes(item, scopes)
        ]
    else:
        # Freestyle passes explicit unit scope: allow reinforcement + calendar-today
        # formal nodes so scoped freezes match the immersive card due_node_uids set.
        allow_scope_extras = scope_node_uids is not None
        wave = [
            item
            for item in projection.get("nodes") or []
            if item.get("due")
            or (
                allow_scope_extras
                and (
                    item.get("reinforcement_due")
                    or item.get("calendar_today_due")
                    or item.get("progress_bucket")
                    in {
                        PROGRESS_SCOPE_REINFORCEMENT,
                        PROGRESS_SCOPE_CALENDAR_TODAY,
                    }
                )
            )
        ]
    if not wave:
        return []
    due_by_uid = {
        str(item["node_uid"]): item for item in wave if item.get("node_uid")
    }
    if scope_node_uids is not None:
        ordered: list[str] = []
        seen: set[str] = set()
        for raw in scope_node_uids:
            uid = str(raw or "").strip()
            if not uid or uid in seen or uid not in due_by_uid:
                continue
            seen.add(uid)
            ordered.append(uid)
        return ordered
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


def _formal_session_wave_id(session: Session, study_session_id: str) -> str | None:
    row = session.get(StudySession, study_session_id)
    if row is None or not row.summary_json:
        return None
    try:
        summary = json.loads(row.summary_json)
    except (TypeError, ValueError):
        return None
    wave_id = summary.get("wave_id")
    return str(wave_id) if wave_id else None


VALID_SOURCE_SCENES = frozenset({"formal_review", "practice", "local_practice"})

# 评分作用域语义：
#   single        只回忆了这个节点 → 仅该节点真实 FSRS 更新
#   branch_recall 整枝真实展开回忆 → 节点+后代都真实 FSRS 更新（旧名 subtree）
#   bulk_mark     批量带过（未真实回忆）→ 零 FSRS 写入，仅留事件痕迹
VALID_RATING_SCOPES = frozenset({"single", "branch_recall", "bulk_mark"})
_SCOPE_ALIASES = {"subtree": "branch_recall"}


def rate_nodes(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    rating: int,
    study_session_id: str,
    operation_id: str,
    rating_scope: str = "branch_recall",
    conflict_policy: str = "overwrite",
    source_scene: str = "formal_review",
    recall_round: str = "first",
    rating_source: str = "manual",
    inference_confidence: float | None = None,
    response_ms: int | None = None,
    hint_count: int = 0,
    retry_count: int = 0,
    commit: bool = True,
) -> dict[str, Any]:
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be between 1 and 4")
    rating_scope = _SCOPE_ALIASES.get(rating_scope, rating_scope)
    if rating_scope not in VALID_RATING_SCOPES:
        raise ValueError("rating_scope must be single, branch_recall or bulk_mark")
    if conflict_policy not in {"overwrite", "skip_direct"}:
        raise ValueError("conflict_policy must be overwrite or skip_direct")
    # quiz 等场景已退出评分体系：评分只能来自导图复习/练习。
    if source_scene not in VALID_SOURCE_SCENES:
        raise ValueError(f"source_scene {source_scene!r} may not write memory ratings")
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
        root_uid, nodes = _tree(palace)
        states = _load_palace_node_states(session, palace_id)
        return {
            "operation_id": operation_id,
            "affected_node_count": existing.affected_node_count,
            "idempotent": True,
            **_rating_mutation_projection(
                session,
                palace,
                root_uid=root_uid,
                nodes=nodes,
                states=states,
            ),
        }
    root_uid, nodes = _tree(palace)
    if node_uid not in nodes:
        raise ValueError("node not found")
    selected = (
        [node_uid] if rating_scope == "single" else [node_uid, *_descendants(nodes, node_uid)]
    )
    selected = [uid for uid in selected if uid != root_uid]
    # Single and subtree ratings both write any non-root target in the palace.
    # Frozen due scope only soft-dims non-due cards on the frontend and still
    # drives completion / unrated-due counts — it does not block mid-session
    # scores on context cards outside this wave.
    # Reopen completed formal sessions so post-settlement amendments work
    # (otherwise the active-session gate would reject the write).
    study_row = session.get(StudySession, study_session_id)
    if (
        source_scene == "formal_review"
        and study_row is not None
        and study_row.scene in {"review", "reinforcement_review"}
        and study_row.status in {"completed", "recovered"}
    ):
        from memory_anki.modules.memory.application.formal_review_service import (
            ensure_formal_review_session_active,
        )

        ensure_formal_review_session_active(study_row, session)
    if conflict_policy == "skip_direct" and rating_scope in {"branch_recall", "bulk_mark"}:
        # "避开": leave every already-scored descendant alone (direct or
        # inherited). Otherwise a mid-node branch score (hard on child +
        # grandchildren) is half-overwritten when the parent later chooses 避开 —
        # only the direct child was skipped, grandchildren got the parent score.
        already_rated_uids = _session_rated_uids(
            session,
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        )
        # Always re-rate the target node; skip descendants that already have a score.
        selected = [uid for uid in selected if uid == node_uid or uid not in already_rated_uids]
    if not selected:
        if node_uid == root_uid:
            raise ValueError("root node cannot be scheduled alone; rate descendants or expand scope")
        raise ValueError("没有可评分节点（子树节点均已评分并选择避开）")
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
    # One tree parse + one full-palace state load shared by before/after rollups
    # and the FSRS write loop (no per-node ReviewNodeState SELECTs).
    states = _load_palace_node_states(session, palace_id)
    reviewed_now = _utc_now()
    before_projection = _rating_mutation_projection(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=reviewed_now,
    )
    before_ratings = _latest_ratings_for_palace(session, palace_id, selected)
    scheduler = _scheduler(session)
    from memory_anki.modules.memory.application.legacy_fsrs_repair import (
        normalize_legacy_card_clock,
    )
    from memory_anki.modules.memory.application.scheduling.daily_plan import (
        record_plan_progress,
    )
    from memory_anki.modules.memory.application.wave_service import (
        apply_rating_to_schedule,
        mark_wave_item_rated,
    )

    # Hoist session/wave lookups out of the selected-node loop (subtree scores).
    formal_wave_id = (
        _formal_session_wave_id(session, study_session_id)
        if source_scene == "formal_review"
        else None
    )
    formal_wave = session.get(ReviewWave, formal_wave_id) if formal_wave_id else None
    events: list[MindMapRecallEvent] = []
    items: list[ReviewRatingOperationItem] = []
    for uid in selected:
        row = states.get(uid)
        before = _state_dict(row)
        before_rating = before_ratings.get(uid)
        fingerprint = nodes[uid]["content_fingerprint"]

        if rating_scope == "bulk_mark":
            # 批量带过：没有真实回忆发生 → 零 FSRS 写入（S/D/due 全部不动，
            # 未学过的节点也不建 state 行）。只留事件痕迹 + 关闭波次项。
            evidence_origin = "bulk_mark"
            if formal_wave_id:
                mark_wave_item_rated(
                    session,
                    palace_id=palace_id,
                    node_uid=uid,
                    wave_id=formal_wave_id,
                    rating=rating,
                    evidence_origin=evidence_origin,
                    operation_id=operation_id,
                    wave=formal_wave,
                )
            event_id = _event_id(operation_id, uid)
            events.append(
                MindMapRecallEvent(
                    id=event_id,
                    study_session_id=study_session_id,
                    palace_id=palace_id,
                    node_uid=uid,
                    source_scene=source_scene,
                    recall_round=recall_round,
                    rating=rating,
                    rating_source="bulk_mark",
                    rating_scope=rating_scope,
                    evidence_origin=evidence_origin,
                    inference_confidence=inference_confidence,
                    operation_id=operation_id,
                    response_ms=response_ms,
                    hint_count=max(0, hint_count),
                    retry_count=max(0, retry_count),
                )
            )
            items.append(
                ReviewRatingOperationItem(
                    operation_id=operation_id,
                    palace_id=palace_id,
                    node_uid=uid,
                    event_id=event_id,
                    before_state_json=(
                        json.dumps(before, ensure_ascii=False) if before else None
                    ),
                    after_state_json=json.dumps(
                        before if before else {}, ensure_ascii=False
                    ),
                    before_rating=before_rating,
                )
            )
            continue

        # Content edit invalidates prior schedule, but the unique key is still
        # (palace_id, node_uid). Keep the existing row and start a fresh card
        # instead of INSERT (which raised IntegrityError → HTTP 500).
        schedule_row = (
            row if row is not None and row.content_fingerprint == fingerprint else None
        )
        card = _card_from_state(schedule_row, card_id=_card_id(palace_id, uid))
        # Legacy migration seeds often carry multi-week overdue clocks. Rating them
        # "as late but remembered" inflates stability into mastery 100% in one pass.
        # Normalize clocks (not S/D) right before the first real FSRS write.
        if schedule_row is not None and (
            schedule_row.state_source == "legacy_estimate"
            or "legacy" in str(schedule_row.parameter_version or "").lower()
        ):
            card = normalize_legacy_card_clock(card)
        card, _log = scheduler.review_card(card, Rating(rating), review_datetime=reviewed_now)
        if row is None:
            row = ReviewNodeState(palace_id=palace_id, node_uid=uid)
            session.add(row)
            states[uid] = row
        evidence_origin = "direct" if uid == node_uid else "branch_recall"
        _apply_card(row, card, fingerprint=fingerprint, source="manual", session=session)

        # Mark frozen formal-wave item before schedule reassignment (weak → reinforcement).
        if formal_wave_id:
            mark_wave_item_rated(
                session,
                palace_id=palace_id,
                node_uid=uid,
                wave_id=formal_wave_id,
                rating=rating,
                evidence_origin=evidence_origin,
                operation_id=operation_id,
                wave=formal_wave,
            )

        raw_due = _naive(card.due) or utc_now_naive()
        apply_rating_to_schedule(
            session,
            row,
            rating=rating,
            raw_due_at=raw_due,
            evidence_origin=evidence_origin,
            source_scene=source_scene,
        )
        record_plan_progress(
            session,
            palace_id=palace_id,
            node_uid=uid,
            reviewed_at=_naive(reviewed_now),
        )
        event_id = _event_id(operation_id, uid)
        events.append(
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
                evidence_origin=evidence_origin,
                inference_confidence=inference_confidence,
                operation_id=operation_id,
                response_ms=response_ms,
                hint_count=max(0, hint_count),
                retry_count=max(0, retry_count),
            )
        )
        items.append(
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
    session.add_all(events)
    session.add_all(items)
    session.flush()
    _clear_due_rollup_cache(session)
    # Reuse the same in-memory ORM rows (already mutated) for after rollup.
    after_projection = _rating_mutation_projection(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=reviewed_now,
    )
    if commit:
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
