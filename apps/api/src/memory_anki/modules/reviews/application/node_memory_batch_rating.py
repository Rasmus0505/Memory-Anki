"""Batch single-scope FSRS ratings (settlement one-tap / bulk unrated)."""

from __future__ import annotations

import json
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
    ReviewWaveItem,
)
from memory_anki.modules.reviews.application.fsrs_runtime import VALID_RATINGS, ensure_strong_rating_due
from memory_anki.modules.reviews.application.node_memory_projection import (
    _apply_card,
    _card_from_state,
    _card_id,
    _clear_due_rollup_cache,
    _event_id,
    _latest_ratings_for_palace,
    _load_palace_node_states,
    _naive,
    _scheduler,
    _session_rated_uids,
    _state_dict,
    _tree,
    _utc_now,
)
from memory_anki.modules.reviews.application.wave_policy import (
    ITEM_DONE,
    ITEM_RATED_DIRECT,
    ITEM_RATED_INHERITED,
)


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


def rate_nodes_batch_single(
    session: Session,
    *,
    palace_id: int,
    node_operation_ids: list[tuple[str, str]],
    rating: int,
    study_session_id: str,
    conflict_policy: str = "skip_direct",
    source_scene: str = "formal_review",
    recall_round: str = "first",
    rating_source: str = "manual",
    commit: bool = True,
) -> dict[str, Any]:
    """Rate many nodes as independent single-scope operations in one load/commit.

    Settlement one-tap scoring uses this so N unrated leaves do not pay N tree
    parses, N full-palace state loads, 2N rollups, or N SQLite commits.
    """
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be between 1 and 4")
    if conflict_policy not in {"overwrite", "skip_direct"}:
        raise ValueError("conflict_policy must be overwrite or skip_direct")
    if not node_operation_ids:
        return {
            "affected_node_count": 0,
            "affected_node_uids": [],
            "operation_ids": [],
            "skipped_operation_ids": [],
        }

    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")

    root_uid, nodes = _tree(palace)
    states = _load_palace_node_states(session, palace_id)
    formal_scope: set[str] | None = None
    if source_scene == "formal_review" and (
        study_session_id.startswith("review-")
        or session.get(StudySession, study_session_id) is not None
    ):
        from memory_anki.modules.reviews.application.formal_review_service import (
            get_formal_review_scope,
        )

        formal_scope = get_formal_review_scope(session, study_session_id, palace_id)

    already_rated: set[str] = set()
    if conflict_policy == "skip_direct":
        already_rated = _session_rated_uids(
            session,
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        )

    from memory_anki.modules.reviews.application.legacy_fsrs_repair import (
        normalize_legacy_card_clock,
    )
    from memory_anki.modules.reviews.application.wave_service import (
        apply_rating_to_schedule,
        mark_wave_item_rated,
    )

    formal_wave_id = (
        _formal_session_wave_id(session, study_session_id)
        if source_scene == "formal_review"
        else None
    )
    formal_wave = session.get(ReviewWave, formal_wave_id) if formal_wave_id else None
    # Preload formal-wave items so marking scores does not N+1 query each leaf.
    wave_items_by_uid: dict[str, ReviewWaveItem] = {}
    if formal_wave_id:
        wave_items_by_uid = {
            item.node_uid: item
            for item in session.query(ReviewWaveItem)
            .filter(
                ReviewWaveItem.wave_id == formal_wave_id,
                ReviewWaveItem.palace_id == palace_id,
            )
            .all()
        }
    scheduler = _scheduler(session)
    reviewed_now = _utc_now()
    selected_uids = [uid for uid, _ in node_operation_ids if uid in nodes]
    before_ratings = _latest_ratings_for_palace(session, palace_id, selected_uids)
    op_ids = [op_id for _, op_id in node_operation_ids]
    existing_ops = {
        op.id: op
        for op in session.query(ReviewRatingOperation)
        .filter(ReviewRatingOperation.id.in_(op_ids))
        .all()
    } if op_ids else {}

    affected: list[str] = []
    operation_ids: list[str] = []
    skipped: list[str] = []
    events: list[MindMapRecallEvent] = []
    items: list[ReviewRatingOperationItem] = []

    for node_uid, operation_id in node_operation_ids:
        existing = existing_ops.get(operation_id)
        if existing is not None:
            if (
                existing.study_session_id != study_session_id
                or existing.palace_id != palace_id
                or existing.root_node_uid != node_uid
                or existing.rating != rating
                or existing.rating_scope != "single"
            ):
                raise ValueError("rating operation belongs to another request")
            if node_uid not in affected:
                affected.append(node_uid)
                operation_ids.append(operation_id)
            continue
        if node_uid not in nodes or node_uid == root_uid:
            skipped.append(node_uid)
            continue
        if formal_scope is not None and node_uid not in formal_scope:
            skipped.append(node_uid)
            continue
        if conflict_policy == "skip_direct" and node_uid in already_rated:
            skipped.append(node_uid)
            continue

        session.add(
            ReviewRatingOperation(
                id=operation_id,
                study_session_id=study_session_id,
                palace_id=palace_id,
                root_node_uid=node_uid,
                rating=rating,
                rating_scope="single",
                affected_node_count=1,
            )
        )
        row = states.get(node_uid)
        before = _state_dict(row)
        before_rating = before_ratings.get(node_uid)
        fingerprint = nodes[node_uid]["content_fingerprint"]
        schedule_row = (
            row if row is not None and row.content_fingerprint == fingerprint else None
        )
        card = _card_from_state(schedule_row, card_id=_card_id(palace_id, node_uid))
        if schedule_row is not None and (
            schedule_row.state_source == "legacy_estimate"
            or "legacy" in str(schedule_row.parameter_version or "").lower()
        ):
            card = normalize_legacy_card_clock(card)
        card, _log = scheduler.review_card(card, Rating(rating), review_datetime=reviewed_now)
        card = ensure_strong_rating_due(card, rating, now=reviewed_now)
        if row is None:
            row = ReviewNodeState(palace_id=palace_id, node_uid=node_uid)
            session.add(row)
            states[node_uid] = row
        evidence_origin = "direct"
        _apply_card(row, card, fingerprint=fingerprint, source="manual")
        if formal_wave_id:
            wave_item = wave_items_by_uid.get(node_uid)
            if wave_item is not None:
                now_naive = utc_now_naive()
                was_rated = wave_item.status in (
                    ITEM_RATED_DIRECT,
                    ITEM_RATED_INHERITED,
                    ITEM_DONE,
                )
                wave_item.rating = rating
                wave_item.rated_at = now_naive
                wave_item.rating_operation_id = operation_id
                wave_item.evidence_origin = evidence_origin
                wave_item.status = ITEM_RATED_DIRECT
                wave_item.updated_at = now_naive
                if formal_wave is not None and not was_rated:
                    formal_wave.rated_count = int(formal_wave.rated_count or 0) + 1
                    formal_wave.updated_at = now_naive
            else:
                mark_wave_item_rated(
                    session,
                    palace_id=palace_id,
                    node_uid=node_uid,
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
        event_id = _event_id(operation_id, node_uid)
        events.append(
            MindMapRecallEvent(
                id=event_id,
                study_session_id=study_session_id,
                palace_id=palace_id,
                node_uid=node_uid,
                source_scene=source_scene,
                recall_round=recall_round,
                rating=rating,
                rating_source=rating_source,
                rating_scope="single",
                evidence_origin=evidence_origin,
                inference_confidence=None,
                operation_id=operation_id,
                response_ms=None,
                hint_count=0,
                retry_count=0,
            )
        )
        items.append(
            ReviewRatingOperationItem(
                operation_id=operation_id,
                palace_id=palace_id,
                node_uid=node_uid,
                event_id=event_id,
                before_state_json=json.dumps(before, ensure_ascii=False) if before else None,
                after_state_json=json.dumps(_state_dict(row), ensure_ascii=False),
                before_rating=before_rating,
            )
        )
        affected.append(node_uid)
        operation_ids.append(operation_id)
        already_rated.add(node_uid)

    if events:
        session.add_all(events)
    if items:
        session.add_all(items)
    if events or items:
        session.flush()
        _clear_due_rollup_cache(session)
    if commit and (events or items or affected):
        session.commit()
    return {
        "affected_node_count": len(affected),
        "affected_node_uids": affected,
        "operation_ids": operation_ids,
        "skipped_operation_ids": skipped,
    }
