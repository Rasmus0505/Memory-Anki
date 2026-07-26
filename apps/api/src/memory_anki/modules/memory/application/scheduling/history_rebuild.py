"""历史修复重建：从空白卡重放真实回忆事件，剔除 batch_inherited 污染。

预览（diff 报告）→ 执行（before 快照入 ReviewCalibrationOperation，
mode=kernel_rebuild，可回滚）→ 回滚（含恢复被删行）。

规则：
- 只重放 evidence_origin ∈ {direct, branch_recall} 且未 undone 的事件；
- 没有任何真实回忆的卡删除 state 行 → 回到 backlog，由每日新学额度放出；
- 重建后 due_at = raw_due_at（聚合清零，想聚合再手动开）；
- 旧的 scheduled 正式波次取消（吸附遗留），reinforcement 波次不动。
"""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import UTC
from typing import Any

from fsrs import Card, Rating
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewCalibrationOperation,
    ReviewCalibrationOperationItem,
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewWave,
)
from memory_anki.modules.memory.application.fsrs_runtime import (
    SCHEDULER_VERSION,
    build_scheduler,
    load_fsrs_settings,
)

REBUILD_MODE = "kernel_rebuild"
REBUILD_REASON = "kernel_rebuild_v1"
TRUSTED_ORIGINS = ("direct", "branch_recall")


def _aware(value):
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _naive(value):
    if value is None:
        return None
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _trusted_events_by_node(
    session: Session, *, palace_ids: list[int] | None
) -> dict[tuple[int, str], list[MindMapRecallEvent]]:
    undone_ids = {
        row[0]
        for row in session.query(ReviewRatingOperation.id)
        .filter(ReviewRatingOperation.undone_at.is_not(None))
        .all()
    }
    query = session.query(MindMapRecallEvent).filter(
        MindMapRecallEvent.evidence_origin.in_(TRUSTED_ORIGINS)
    )
    if palace_ids:
        query = query.filter(MindMapRecallEvent.palace_id.in_(palace_ids))
    events = query.order_by(
        MindMapRecallEvent.occurred_at.asc(), MindMapRecallEvent.created_at.asc()
    ).all()
    grouped: dict[tuple[int, str], list[MindMapRecallEvent]] = defaultdict(list)
    for event in events:
        if event.operation_id and event.operation_id in undone_ids:
            continue
        grouped[(int(event.palace_id), str(event.node_uid))].append(event)
    return grouped


def _state_rows(
    session: Session, *, palace_ids: list[int] | None
) -> dict[tuple[int, str], ReviewNodeState]:
    query = session.query(ReviewNodeState).join(
        Palace, Palace.id == ReviewNodeState.palace_id
    ).filter(Palace.deleted_at.is_(None))
    if palace_ids:
        query = query.filter(ReviewNodeState.palace_id.in_(palace_ids))
    return {(int(row.palace_id), row.node_uid): row for row in query.all()}


def _replay_node(
    scheduler, card_id: int, events: list[MindMapRecallEvent]
) -> Card:
    card = Card(card_id=card_id)
    for event in events:
        occurred = _aware(getattr(event, "occurred_at", None) or event.created_at)
        if occurred is None:
            continue
        rating = 3 if event.rating == 5 else int(event.rating)
        if rating not in (1, 2, 3, 4):
            continue
        card, _log = scheduler.review_card(card, Rating(rating), review_datetime=occurred)
    return card


def _snapshot(row: ReviewNodeState | None) -> dict[str, Any] | None:
    from memory_anki.modules.memory.application.node_memory_projection import _state_dict

    return _state_dict(row)


def compute_rebuild(
    session: Session, *, palace_ids: list[int] | None = None
) -> dict[str, Any]:
    """纯计算：每个节点的重建目标状态与 diff 统计（不写库）。"""
    # 重建必须确定性：关 fuzz。
    scheduler = build_scheduler(session, enable_fuzzing=False)
    settings = load_fsrs_settings(session)
    from memory_anki.modules.memory.application.node_memory_projection import _card_id

    events_by_node = _trusted_events_by_node(session, palace_ids=palace_ids)
    rows = _state_rows(session, palace_ids=palace_ids)
    keys = set(events_by_node) | set(rows)

    plans: list[dict[str, Any]] = []
    to_backlog = 0
    shift_earlier = 0
    shift_later = 0
    unchanged = 0
    for key in sorted(keys):
        pid, uid = key
        row = rows.get(key)
        events = events_by_node.get(key) or []
        if not events:
            # 无真实回忆：删行回 backlog（含仅有 bulk_mark/inherited 历史的卡）。
            if row is not None:
                plans.append(
                    {
                        "palace_id": pid,
                        "node_uid": uid,
                        "action": "delete",
                        "before": _snapshot(row),
                        "after": None,
                    }
                )
                to_backlog += 1
            continue
        card = _replay_node(scheduler, _card_id(pid, uid), events)
        new_due = _naive(card.due)
        old_due = row.due_at if row is not None else None
        after = {
            "state": int(card.state),
            "step": card.step,
            "stability": card.stability,
            "difficulty": card.difficulty,
            "due_at": new_due.isoformat() if new_due else None,
            "raw_due_at": new_due.isoformat() if new_due else None,
            "last_review_at": (
                _naive(card.last_review).isoformat() if card.last_review else None
            ),
            "desired_retention": float(settings["desired_retention"]),
            "maximum_interval": int(settings["maximum_interval"]),
            "state_source": "manual",
            "schedule_source": "manual",
            "evidence_source": "direct",
            "effective_wave_id": None,
            "effective_local_date": None,
            "schedule_reason": REBUILD_REASON,
            "scheduler_version": SCHEDULER_VERSION,
            "parameter_version": str(settings.get("parameter_version") or "default"),
            "content_fingerprint": str(row.content_fingerprint or "") if row else "",
        }
        if row is not None and old_due is not None and new_due is not None:
            delta_days = (new_due - old_due).total_seconds() / 86400.0
            if delta_days < -0.5:
                shift_earlier += 1
            elif delta_days > 0.5:
                shift_later += 1
            else:
                unchanged += 1
        plans.append(
            {
                "palace_id": pid,
                "node_uid": uid,
                "action": "rebuild",
                "before": _snapshot(row),
                "after": after,
                "replayed_event_count": len(events),
            }
        )
    return {
        "plans": plans,
        "summary": {
            "affected_node_count": len(plans),
            "rebuilt_count": sum(1 for p in plans if p["action"] == "rebuild"),
            "to_backlog_count": to_backlog,
            "due_earlier_count": shift_earlier,
            "due_later_count": shift_later,
            "due_unchanged_count": unchanged,
            "parameter_version": str(settings.get("parameter_version") or "default"),
        },
    }


def preview_rebuild(
    session: Session, *, palace_ids: list[int] | None = None, sample_size: int = 50
) -> dict[str, Any]:
    result = compute_rebuild(session, palace_ids=palace_ids)
    samples = [
        {
            "palace_id": plan["palace_id"],
            "node_uid": plan["node_uid"],
            "action": plan["action"],
            "before_due": (plan["before"] or {}).get("due_at"),
            "after_due": (plan["after"] or {}).get("due_at"),
            "before_stability": (plan["before"] or {}).get("stability"),
            "after_stability": (plan["after"] or {}).get("stability"),
        }
        for plan in result["plans"][:sample_size]
    ]
    return {**result["summary"], "samples": samples}


def execute_rebuild(
    session: Session, *, palace_ids: list[int] | None = None
) -> dict[str, Any]:
    from datetime import datetime as _dt

    result = compute_rebuild(session, palace_ids=palace_ids)
    plans = result["plans"]
    now = utc_now_naive()
    operation = ReviewCalibrationOperation(
        id=f"rebuild-{uuid.uuid4()}",
        palace_id=int(plans[0]["palace_id"]) if plans else 0,
        mode=REBUILD_MODE,
        scope_kind="palace" if palace_ids else "nodes",
        scope_json=json.dumps({"palace_ids": palace_ids or "all"}),
        preview_only=False,
        affected_node_count=len(plans),
        created_at=now,
    )
    session.add(operation)
    session.flush()

    for plan in plans:
        pid = int(plan["palace_id"])
        uid = str(plan["node_uid"])
        session.add(
            ReviewCalibrationOperationItem(
                operation_id=operation.id,
                palace_id=pid,
                node_uid=uid,
                before_state_json=json.dumps(plan["before"], ensure_ascii=False),
                after_state_json=json.dumps(plan["after"], ensure_ascii=False),
            )
        )
        row = (
            session.query(ReviewNodeState)
            .filter_by(palace_id=pid, node_uid=uid)
            .first()
        )
        if plan["action"] == "delete":
            if row is not None:
                session.delete(row)
            continue
        after = plan["after"]
        if row is None:
            row = ReviewNodeState(palace_id=pid, node_uid=uid)
            session.add(row)
        row.state = int(after["state"])
        row.step = after["step"]
        row.stability = after["stability"]
        row.difficulty = after["difficulty"]
        row.due_at = _dt.fromisoformat(after["due_at"]) if after["due_at"] else now
        row.raw_due_at = (
            _dt.fromisoformat(after["raw_due_at"]) if after["raw_due_at"] else None
        )
        row.last_review_at = (
            _dt.fromisoformat(after["last_review_at"])
            if after["last_review_at"]
            else None
        )
        row.desired_retention = after["desired_retention"]
        row.maximum_interval = after["maximum_interval"]
        row.state_source = after["state_source"]
        row.schedule_source = after["schedule_source"]
        row.evidence_source = after["evidence_source"]
        row.effective_wave_id = None
        row.effective_local_date = None
        row.schedule_reason = after["schedule_reason"]
        row.scheduler_version = after["scheduler_version"]
        row.parameter_version = after["parameter_version"]
        row.updated_at = now

    # 旧的 scheduled 正式波次是吸附遗留 → 取消；active/paused 会话波次同样
    # 取消（重建后冻结集语义已失效），completed 保留历史；reinforcement 不动。
    wave_query = session.query(ReviewWave).filter(
        ReviewWave.wave_type == "formal_long_term",
        ReviewWave.status.in_(["scheduled", "active", "paused"]),
    )
    if palace_ids:
        wave_query = wave_query.filter(ReviewWave.palace_id.in_(palace_ids))
    cancelled_waves = 0
    for wave in wave_query.all():
        wave.status = "cancelled"
        wave.completed_at = now
        wave.active_session_id = None
        wave.notes = f"{wave.notes or ''}\ncancelled_by={operation.id}".strip()
        wave.updated_at = now
        cancelled_waves += 1

    session.flush()
    return {
        "operation_id": operation.id,
        **result["summary"],
        "cancelled_wave_count": cancelled_waves,
    }


def rollback_rebuild(session: Session, *, operation_id: str) -> dict[str, Any]:
    from memory_anki.modules.memory.application.node_memory_projection import (
        _restore_state,
    )

    operation = session.get(ReviewCalibrationOperation, operation_id)
    if operation is None or operation.mode != REBUILD_MODE:
        raise ValueError("rebuild operation not found")
    if operation.undone_at is not None:
        raise ValueError("rebuild operation already rolled back")
    items = (
        session.query(ReviewCalibrationOperationItem)
        .filter(ReviewCalibrationOperationItem.operation_id == operation_id)
        .all()
    )
    restored = 0
    for item in items:
        try:
            snapshot = json.loads(item.before_state_json) if item.before_state_json else None
        except (TypeError, ValueError):
            snapshot = None
        _restore_state(session, int(item.palace_id), str(item.node_uid), snapshot)
        restored += 1
    operation.undone_at = utc_now_naive()
    session.flush()
    return {"operation_id": operation_id, "restored_node_count": restored}
