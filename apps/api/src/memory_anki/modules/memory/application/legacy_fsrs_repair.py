"""Repair inflated FSRS node state after legacy-stage migration seeds.

Legacy migration wrote ``state_source=legacy_estimate`` cards with historical
``last_review_at`` / overdue ``due_at``. The first real FSRS Good on those cards
treats multi-week lateness as proof of high stability and can push mastery to 100%%
in one session. This module:

1. Reverts the first inflated legacy jump per node and replays later ratings.
2. Normalizes remaining legacy clocks so the next review is not "weeks overdue".
3. Rewrites formal-review completion receipts so mastery trends match live state.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fsrs import Card, Rating, State
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
)
from memory_anki.modules.memory.application.fsrs_runtime import (
    DEFAULT_MAXIMUM_INTERVAL,
    DEFAULT_RETENTION,
    PARAMETER_VERSION,
    SCHEDULER_VERSION,
    build_scheduler,
)
from memory_anki.modules.memory.application.node_memory_service import (
    get_palace_memory_projection,
)

LEGACY_STATE_SOURCE = "legacy_estimate"
LEGACY_PARAM_MARKERS = ("legacy",)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _parse_json(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def is_legacy_state_source(source: str | None, parameter_version: str | None = None) -> bool:
    if str(source or "").strip() == LEGACY_STATE_SOURCE:
        return True
    version = str(parameter_version or "").lower()
    return any(marker in version for marker in LEGACY_PARAM_MARKERS)


def is_inflated_legacy_jump(
    before: dict[str, Any] | None, after: dict[str, Any] | None
) -> bool:
    """True when a rating left a legacy seed and stability jumped hard."""
    if not before or not after:
        return False
    if not is_legacy_state_source(
        before.get("state_source"), before.get("parameter_version")
    ):
        return False
    try:
        before_s = float(before.get("stability") or 0.0)
        after_s = float(after.get("stability") or 0.0)
    except (TypeError, ValueError):
        return False
    if after_s <= before_s:
        return False
    # Absolute and relative guards: S=7→33 or S=15→65 both match; tiny bumps do not.
    return after_s >= max(20.0, before_s * 2.0) or (after_s - before_s) >= 15.0


# Cap the synthetic elapsed interval used when repairing legacy clocks.
# Using full stability days as elapsed makes on-time Good still jump hard
# (e.g. S=15 → ~46). A short capped interval keeps the next Good as a normal
# reinforcement instead of "remembered after a long gap".
LEGACY_CLOCK_MAX_ELAPSED_DAYS = 3.0


def _legacy_clock_elapsed_days(stability: float | None) -> float:
    return min(max(float(stability or 0.0), 0.1), LEGACY_CLOCK_MAX_ELAPSED_DAYS)


def normalize_legacy_card_clock(card: Card, *, now: datetime | None = None) -> Card:
    """Rewrite legacy overdue clocks so the next review is not multi-week late.

    Keeps stability/difficulty/state; sets ``due`` to *now* and backdates
    ``last_review`` by a short capped interval (not the full stability span).
    """
    now_aware = _aware(now) or datetime.now(UTC)
    interval_days = _legacy_clock_elapsed_days(card.stability)
    card.due = now_aware
    card.last_review = now_aware - timedelta(days=interval_days)
    return card


def normalize_legacy_row_clock(
    row: ReviewNodeState, *, now: datetime | None = None
) -> bool:
    """In-place clock fix for a persisted legacy row. Returns whether it changed."""
    if not is_legacy_state_source(row.state_source, row.parameter_version):
        return False
    now_naive = _naive(now) or utc_now_naive()
    interval_days = _legacy_clock_elapsed_days(row.stability)
    new_last = now_naive - timedelta(days=interval_days)
    changed = row.due_at != now_naive or row.last_review_at != new_last
    row.due_at = now_naive
    row.last_review_at = new_last
    row.updated_at = utc_now_naive()
    return changed

def _card_from_snapshot(snapshot: dict[str, Any], *, card_id: int) -> Card:
    return Card(
        card_id=card_id,
        state=State(int(snapshot["state"])),
        step=snapshot.get("step"),
        stability=snapshot.get("stability"),
        difficulty=snapshot.get("difficulty"),
        due=_aware(datetime.fromisoformat(snapshot["due_at"])) or datetime.now(UTC),
        last_review=(
            _aware(datetime.fromisoformat(snapshot["last_review_at"]))
            if snapshot.get("last_review_at")
            else None
        ),
    )


def _card_id(palace_id: int, node_uid: str) -> int:
    import hashlib

    return int(hashlib.sha256(f"{palace_id}:{node_uid}".encode()).hexdigest()[:15], 16)


def _apply_card_to_row(
    row: ReviewNodeState, card: Card, *, fingerprint: str, source: str = "manual"
) -> None:
    row.state = int(card.state)
    row.step = card.step
    row.stability = card.stability
    row.difficulty = card.difficulty
    row.due_at = _naive(card.due) or utc_now_naive()
    row.last_review_at = _naive(card.last_review)
    row.desired_retention = float(row.desired_retention or DEFAULT_RETENTION)
    row.maximum_interval = int(row.maximum_interval or DEFAULT_MAXIMUM_INTERVAL)
    row.content_fingerprint = fingerprint
    row.state_source = source
    row.scheduler_version = SCHEDULER_VERSION
    row.parameter_version = PARAMETER_VERSION
    row.updated_at = utc_now_naive()


def _restore_snapshot(row: ReviewNodeState, snapshot: dict[str, Any]) -> None:
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
    if snapshot.get("content_fingerprint") is not None:
        row.content_fingerprint = str(snapshot.get("content_fingerprint") or "")
    row.state_source = str(snapshot.get("state_source") or LEGACY_STATE_SOURCE)
    row.scheduler_version = str(snapshot.get("scheduler_version") or SCHEDULER_VERSION)
    row.parameter_version = str(snapshot.get("parameter_version") or "legacy-stage-estimate")
    row.updated_at = utc_now_naive()


def _mastery_summary(session: Session, palace_id: int) -> dict[str, Any]:
    try:
        projection = get_palace_memory_projection(session, palace_id, include_ratings=False)
    except ValueError:
        return {"mastery_percent": 0, "mastery_progress": 0.0, "avg_stability": 0.0}
    stabilities = [
        float(item.get("stability_days") or 0.0) for item in projection.get("nodes") or []
    ]
    avg_s = sum(stabilities) / len(stabilities) if stabilities else 0.0
    return {
        "mastery_percent": int(projection.get("mastery_percent") or 0),
        "mastery_progress": float(projection.get("mastery_progress") or 0.0),
        "avg_stability": round(avg_s, 4),
        "due_node_count": int(projection.get("due_node_count") or 0),
        "mastered": bool(projection.get("mastered")),
    }


def _load_item_history(
    session: Session, *, palace_id: int | None, include_undone: bool = False
) -> list[tuple[ReviewRatingOperation, ReviewRatingOperationItem]]:
    query = (
        session.query(ReviewRatingOperation, ReviewRatingOperationItem)
        .join(
            ReviewRatingOperationItem,
            ReviewRatingOperationItem.operation_id == ReviewRatingOperation.id,
        )
        .order_by(
            ReviewRatingOperation.created_at.asc(),
            ReviewRatingOperationItem.id.asc(),
        )
    )
    if not include_undone:
        query = query.filter(ReviewRatingOperation.undone_at.is_(None))
    if palace_id is not None:
        query = query.filter(ReviewRatingOperation.palace_id == palace_id)
    return cast(
        list[tuple[ReviewRatingOperation, ReviewRatingOperationItem]],
        list(query.all()),
    )


def _still_inflated(current_s: float, before_s: float, after_s: float) -> bool:
    """True when current stability still looks like an inflated jump result.

    Covers both the raw first-jump plateau and half-repaired re-inflation
    (later ratings replayed against overdue legacy clocks).
    """
    if current_s <= before_s + 5.0:
        return False
    # Near the original jump, or still far above the pre-jump seed.
    return current_s >= after_s * 0.55 or current_s >= max(before_s * 2.5, before_s + 12.0)


def repair_legacy_fsrs_inflation(
    session: Session,
    *,
    palace_id: int | None = None,
    apply: bool = False,
    normalize_legacy_clocks: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Scan and optionally repair inflated legacy-first ratings.

    Default is dry-run (``apply=False``). When applying, commits once at the end.
    """
    now_naive = _naive(now) or utc_now_naive()
    now_aware = _aware(now_naive) or datetime.now(UTC)
    scheduler = build_scheduler(session)

    # Include undone ops so half-repaired nodes (first jump already marked undone
    # but state still inflated from a bad later-replay) can be recovered.
    pairs = _load_item_history(session, palace_id=palace_id, include_undone=True)
    by_node: dict[tuple[int, str], list[tuple[ReviewRatingOperation, ReviewRatingOperationItem]]] = (
        defaultdict(list)
    )
    for op, item in pairs:
        by_node[(int(item.palace_id), str(item.node_uid))].append((op, item))

    first_jump_keys: set[tuple[str, str]] = set()  # (operation_id, node_uid)
    first_jump_ops: set[str] = set()
    node_plans: list[dict[str, Any]] = []
    skipped_already_ok = 0

    for (pid, node_uid), history in by_node.items():
        first_idx: int | None = None
        first_before: dict[str, Any] | None = None
        first_after: dict[str, Any] | None = None
        first_op: ReviewRatingOperation | None = None
        for index, (op, item) in enumerate(history):
            before = _parse_json(item.before_state_json)
            after = _parse_json(item.after_state_json)
            if is_inflated_legacy_jump(before, after):
                first_idx = index
                first_before = before
                first_after = after
                first_op = op
                break
        if first_idx is None or first_before is None or first_op is None:
            continue
        assert first_after is not None
        before_s = float(first_before.get("stability") or 0.0)
        after_s = float(first_after.get("stability") or 0.0)
        row = (
            session.query(ReviewNodeState)
            .filter_by(palace_id=pid, node_uid=node_uid)
            .first()
        )
        cur_s = float(row.stability or 0.0) if row is not None else after_s
        if not _still_inflated(cur_s, before_s, after_s):
            skipped_already_ok += 1
            continue
        # Keep only live later ratings (skip undone and the first jump itself).
        later_history = [
            (op, item)
            for op, item in history[first_idx + 1 :]
            if op.undone_at is None
        ]
        first_jump_keys.add((first_op.id, node_uid))
        if first_op.undone_at is None:
            first_jump_ops.add(first_op.id)
        node_plans.append(
            {
                "palace_id": pid,
                "node_uid": node_uid,
                "first_operation_id": first_op.id,
                "first_rating": int(first_op.rating),
                "before_stability": before_s,
                "after_stability": after_s,
                "later_rating_count": len(later_history),
                "before_snapshot": first_before,
                "later": later_history,
            }
        )

    affected_palace_ids = sorted({plan["palace_id"] for plan in node_plans})
    before_by_palace = {
        pid: _mastery_summary(session, pid) for pid in affected_palace_ids
    }

    ops_to_undo: set[str] = set()
    for op_id in first_jump_ops:
        items = (
            session.query(ReviewRatingOperationItem)
            .filter(ReviewRatingOperationItem.operation_id == op_id)
            .all()
        )
        if items and all((op_id, item.node_uid) in first_jump_keys for item in items):
            ops_to_undo.add(op_id)

    repaired_nodes = 0
    if apply:
        for plan in node_plans:
            pid = int(plan["palace_id"])
            node_uid = str(plan["node_uid"])
            row = (
                session.query(ReviewNodeState)
                .filter_by(palace_id=pid, node_uid=node_uid)
                .first()
            )
            if row is None:
                row = ReviewNodeState(palace_id=pid, node_uid=node_uid)
                session.add(row)
            snapshot = dict(plan["before_snapshot"])
            _restore_snapshot(row, snapshot)
            fingerprint = str(row.content_fingerprint or "")
            later: list[tuple[ReviewRatingOperation, ReviewRatingOperationItem]] = plan["later"]
            if later:
                # Stage clocks so the first kept rating is on-time. Replaying later
                # ratings against multi-week-overdue legacy last_review re-inflates S.
                first_at = _aware(later[0][0].created_at) or now_aware
                interval = _legacy_clock_elapsed_days(row.stability)
                row.due_at = _naive(first_at) or now_naive
                row.last_review_at = _naive(first_at - timedelta(days=interval))
                card = Card(
                    card_id=_card_id(pid, node_uid),
                    state=State(int(row.state)),
                    step=row.step,
                    stability=row.stability,
                    difficulty=row.difficulty,
                    due=_aware(row.due_at) or first_at,
                    last_review=_aware(row.last_review_at),
                )
                for op, _item in later:
                    review_at = _aware(op.created_at) or now_aware
                    if card.due is not None and review_at > card.due + timedelta(days=1):
                        review_at = card.due
                    card, _log = scheduler.review_card(
                        card, Rating(int(op.rating)), review_datetime=review_at
                    )
                _apply_card_to_row(row, card, fingerprint=fingerprint, source="manual")
            else:
                normalize_legacy_row_clock(row, now=now_naive)
            repaired_nodes += 1

        undo_at = now_naive
        for op_id in ops_to_undo:
            rating_op = session.get(ReviewRatingOperation, op_id)
            if rating_op is not None and rating_op.undone_at is None:
                rating_op.undone_at = undo_at

    clock_normalized = 0
    clock_candidates = 0
    if normalize_legacy_clocks:
        if apply:
            session.flush()
        legacy_query = session.query(ReviewNodeState).filter(
            ReviewNodeState.state_source == LEGACY_STATE_SOURCE
        )
        if palace_id is not None:
            legacy_query = legacy_query.filter(ReviewNodeState.palace_id == palace_id)
        legacy_rows = list(legacy_query.all())
        clock_candidates = len(legacy_rows)
        for row in legacy_rows:
            if apply:
                if normalize_legacy_row_clock(row, now=now_naive):
                    clock_normalized += 1
            else:
                # dry-run: count rows that look overdue or stale relative to stability
                if row.due_at and row.due_at < now_naive - timedelta(hours=1):
                    clock_normalized += 1
                elif row.last_review_at and (
                    now_naive - row.last_review_at
                ).total_seconds() > max(float(row.stability or 0.1), 0.1) * 86400 * 1.5:
                    clock_normalized += 1

    receipts_rewritten = 0
    if apply and affected_palace_ids:
        session.flush()
        for pid in affected_palace_ids:
            projection = get_palace_memory_projection(session, pid, include_ratings=True)
            rows = (
                session.query(StudySession)
                .filter(
                    StudySession.palace_id == pid,
                    StudySession.scene == "review",
                    StudySession.status == "completed",
                    StudySession.deleted_at.is_(None),
                )
                .all()
            )
            for study_row in rows:
                try:
                    summary = json.loads(study_row.summary_json or "{}")
                except (TypeError, json.JSONDecodeError):
                    continue
                if not isinstance(summary, dict):
                    continue
                receipt = summary.get("completion_receipt")
                if not isinstance(receipt, dict):
                    continue
                receipt = dict(receipt)
                receipt["mastery_progress"] = projection["mastery_progress"]
                receipt["mastery_percent"] = projection["mastery_percent"]
                receipt["memory_health"] = projection["memory_health"]
                receipt["memory_health_percent"] = projection["memory_health_percent"]
                receipt["remaining_due_node_count"] = projection["due_node_count"]
                receipt["next_review_at"] = projection["next_review_at"]
                receipt["repaired_legacy_inflation_at"] = now_naive.isoformat()
                summary["completion_receipt"] = receipt
                study_row.summary_json = json.dumps(summary, ensure_ascii=False)
                receipts_rewritten += 1

    after_by_palace: dict[int, dict[str, Any]] = {}
    if apply:
        session.flush()
        for pid in affected_palace_ids:
            after_by_palace[pid] = _mastery_summary(session, pid)
        session.commit()
    else:
        # dry-run estimate for pure restore-only palaces (no later ratings)
        for pid in affected_palace_ids:
            plans = [p for p in node_plans if p["palace_id"] == pid]
            if plans and all(p["later_rating_count"] == 0 for p in plans):
                stabs = [p["before_stability"] for p in plans]
                # include other nodes of palace
                other = (
                    session.query(ReviewNodeState)
                    .filter(ReviewNodeState.palace_id == pid)
                    .all()
                )
                plan_uids = {p["node_uid"] for p in plans}
                for row in other:
                    if row.node_uid not in plan_uids:
                        stabs.append(float(row.stability or 0.0))
                horizon = 60
                progress = (
                    sum(min(s / horizon, 1.0) for s in stabs) / len(stabs) if stabs else 0.0
                )
                after_by_palace[pid] = {
                    "mastery_percent": round(progress * 100),
                    "mastery_progress": round(progress, 4),
                    "avg_stability": round(sum(stabs) / len(stabs), 4) if stabs else 0.0,
                    "estimated": True,
                }
            else:
                after_by_palace[pid] = {
                    "mastery_percent": None,
                    "note": "has later ratings; apply to recompute",
                    "estimated": True,
                }

    palace_titles = {
        int(row.id): str(row.title or "")
        for row in session.query(Palace).filter(Palace.id.in_(affected_palace_ids or [-1])).all()
    }

    per_palace = []
    for pid in affected_palace_ids:
        per_palace.append(
            {
                "palace_id": pid,
                "title": palace_titles.get(pid, ""),
                "nodes_repaired": sum(1 for p in node_plans if p["palace_id"] == pid),
                "before": before_by_palace.get(pid),
                "after": after_by_palace.get(pid),
            }
        )

    return {
        "apply": apply,
        "palace_id_filter": palace_id,
        "nodes_with_inflated_history": len(node_plans) + skipped_already_ok,
        "nodes_still_inflated": len(node_plans),
        "nodes_already_ok": skipped_already_ok,
        "nodes_repaired": repaired_nodes if apply else len(node_plans),
        "operations_marked_undone": len(ops_to_undo) if apply else len(ops_to_undo),
        "legacy_clock_candidates": clock_candidates,
        "legacy_clocks_normalized": clock_normalized if normalize_legacy_clocks else 0,
        "receipts_rewritten": receipts_rewritten,
        "palaces": per_palace,
    }


__all__ = [
    "LEGACY_STATE_SOURCE",
    "is_inflated_legacy_jump",
    "is_legacy_state_source",
    "normalize_legacy_card_clock",
    "normalize_legacy_row_clock",
    "repair_legacy_fsrs_inflation",
]
