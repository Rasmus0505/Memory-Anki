"""Independent calibration ops (align wave / baseline) with audit snapshots."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any

from fsrs import State
from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewCalibrationOperation,
    ReviewCalibrationOperationItem,
    ReviewNodeState,
    ReviewWave,
    ReviewWaveItem,
)
from memory_anki.modules.reviews.application.node_memory_projection import (
    _clear_due_rollup_cache,
    _descendants,
    _state_dict,
    _tree,
)
from memory_anki.modules.reviews.application.wave_policy import (
    BASELINE_TIERS,
    SCHEDULE_CALIBRATED,
    SCHEDULE_UNINITIALIZED,
)
from memory_anki.modules.reviews.application.wave_service import (
    _recount_wave,
    assign_node_to_formal_wave,
    list_palace_waves,
    remove_node_from_open_waves,
)


def _open_wave_item_snapshots(
    session: Session, palace_id: int, node_uid: str
) -> list[dict[str, Any]]:
    items = (
        session.query(ReviewWaveItem)
        .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
        .filter(
            ReviewWaveItem.palace_id == palace_id,
            ReviewWaveItem.node_uid == node_uid,
            ReviewWave.status.in_(["scheduled", "active", "paused"]),
        )
        .all()
    )
    return [
        {
            "wave_id": item.wave_id,
            "status": item.status,
            "evidence_origin": item.evidence_origin,
            "rating": item.rating,
            "rated_at": to_api_datetime(item.rated_at),
            "rating_operation_id": item.rating_operation_id,
            "frozen_raw_due_at": to_api_datetime(item.frozen_raw_due_at),
            "frozen_effective_due_at": to_api_datetime(item.frozen_effective_due_at),
            "included_at": to_api_datetime(item.included_at),
        }
        for item in items
    ]


def _parse_snapshot_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def _restore_open_wave_items(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    snapshots: list[dict[str, Any]],
) -> None:
    current = (
        session.query(ReviewWaveItem)
        .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
        .filter(
            ReviewWaveItem.palace_id == palace_id,
            ReviewWaveItem.node_uid == node_uid,
            ReviewWave.status.in_(["scheduled", "active", "paused"]),
        )
        .all()
    )
    affected_wave_ids = {item.wave_id for item in current}
    for item in current:
        session.delete(item)
    session.flush()
    for snapshot in snapshots:
        wave_id = str(snapshot.get("wave_id") or "")
        if not wave_id or session.get(ReviewWave, wave_id) is None:
            continue
        affected_wave_ids.add(wave_id)
        now = utc_now_naive()
        session.add(
            ReviewWaveItem(
                wave_id=wave_id,
                palace_id=palace_id,
                node_uid=node_uid,
                status=str(snapshot.get("status") or "pending"),
                evidence_origin=snapshot.get("evidence_origin"),
                rating=snapshot.get("rating"),
                rated_at=_parse_snapshot_datetime(snapshot.get("rated_at")),
                rating_operation_id=snapshot.get("rating_operation_id"),
                frozen_raw_due_at=_parse_snapshot_datetime(
                    snapshot.get("frozen_raw_due_at")
                ),
                frozen_effective_due_at=_parse_snapshot_datetime(
                    snapshot.get("frozen_effective_due_at")
                ),
                included_at=_parse_snapshot_datetime(snapshot.get("included_at")) or now,
                created_at=now,
                updated_at=now,
            )
        )
    session.flush()
    for wave_id in affected_wave_ids:
        wave = session.get(ReviewWave, wave_id)
        if wave is None:
            continue
        _recount_wave(session, wave)
        if wave.status == "scheduled" and wave.item_count == 0:
            session.delete(wave)


def _palace_revision(palace: Palace) -> str:
    return hashlib.sha256((palace.editor_doc or "").encode("utf-8")).hexdigest()[:32]


def _date_spread_days(dates: list[str]) -> int:
    if len(dates) < 2:
        return 0
    from datetime import date as date_cls

    first = date_cls.fromisoformat(dates[0])
    last = date_cls.fromisoformat(dates[-1])
    return (last - first).days


def _resolve_scope(
    session: Session,
    palace: Palace,
    *,
    scope_kind: str,
    scope: dict[str, Any],
) -> list[str]:
    root_uid, nodes = _tree(palace)
    valid = [uid for uid in nodes if uid != root_uid]
    if scope_kind == "palace":
        return valid
    if scope_kind == "branch":
        branch_uid = str(scope.get("branch_uid") or "")
        if not branch_uid or branch_uid not in nodes:
            raise ValueError("branch_uid not found")
        return [branch_uid, *_descendants(nodes, branch_uid)] if branch_uid != root_uid else valid
    if scope_kind == "nodes":
        selected = [str(uid) for uid in (scope.get("node_uids") or [])]
        return [uid for uid in selected if uid in nodes and uid != root_uid]
    raise ValueError("scope_kind must be palace, branch, or nodes")


def diagnose_palace(session: Session, palace_id: int) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    from memory_anki.modules.reviews.application.node_memory_service import (
        get_palace_memory_projection,
    )

    projection = get_palace_memory_projection(session, palace_id)
    waves = list_palace_waves(session, palace_id)
    formal = [w for w in waves if w["wave_type"] == "formal_long_term"]
    dates = sorted({w["local_date"] for w in formal if w.get("local_date")})
    nodes = projection.get("nodes") or []
    direct = sum(1 for n in nodes if n.get("evidence_source") == "direct")
    inherited = sum(1 for n in nodes if n.get("evidence_source") == "batch_inherited")
    return {
        "palace_id": palace_id,
        "palace_revision": _palace_revision(palace),
        "wave_count": len(formal),
        "formal_wave_dates": dates,
        "date_spread_days": _date_spread_days(dates),
        "due_node_count": projection.get("due_node_count") or 0,
        "overdue_node_count": projection.get("overdue_node_count") or 0,
        "reinforcement_due_count": projection.get("reinforcement_due_count") or 0,
        "uninitialized_node_count": projection.get("uninitialized_node_count") or 0,
        "content_changed_node_count": projection.get("content_changed_node_count") or 0,
        "direct_evidence_count": direct,
        "inherited_evidence_count": inherited,
        "waves": waves,
    }


def preview_or_apply_calibration(
    session: Session,
    *,
    palace_id: int,
    operation_id: str,
    mode: str,
    scope_kind: str,
    scope: dict[str, Any] | None = None,
    baseline_tier: str | None = None,
    target_local_date: date | str | None = None,
    palace_revision: str | None = None,
    confirm: bool = False,
) -> dict[str, Any]:
    if not operation_id.strip():
        raise ValueError("operation_id is required")
    if mode not in {"align_wave", "baseline"}:
        raise ValueError("mode must be align_wave or baseline")
    existing = session.get(ReviewCalibrationOperation, operation_id)
    if existing is not None:
        if existing.palace_id != palace_id or existing.mode != mode:
            raise ValueError("calibration operation belongs to another request")
        return {
            "operation_id": operation_id,
            "idempotent": True,
            "affected_node_count": existing.affected_node_count,
            "undone": existing.undone_at is not None,
        }

    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    current_rev = _palace_revision(palace)
    if palace_revision and palace_revision != current_rev:
        raise ValueError("palace revision conflict; refresh and retry")

    node_uids = _resolve_scope(session, palace, scope_kind=scope_kind, scope=scope or {})
    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace_id,
            ReviewNodeState.node_uid.in_(node_uids),
        )
        .all()
    }
    before_after: list[tuple[str, dict[str, Any] | None, dict[str, Any]]] = []
    preview_rows: list[dict[str, Any]] = []

    target_day: date | None = None
    if mode == "align_wave":
        if target_local_date is None:
            raise ValueError("target_local_date is required for align_wave")
        try:
            target_day = (
                target_local_date
                if isinstance(target_local_date, date)
                else date.fromisoformat(str(target_local_date))
            )
        except ValueError as exc:
            raise ValueError("target_local_date must be YYYY-MM-DD") from exc

    for uid in node_uids:
        row = states.get(uid)
        before = _state_dict(row)
        before_wave_items = _open_wave_item_snapshots(session, palace_id, uid)
        if not confirm:
            # Preview only: compute planned after without mutating.
            after_preview = dict(before or {})
            if mode == "align_wave":
                after_preview["schedule_source"] = SCHEDULE_CALIBRATED
                after_preview["schedule_reason"] = "align_wave_preview"
                after_preview["effective_local_date"] = (
                    target_day.isoformat() if target_day else None
                )
            else:
                tier = BASELINE_TIERS.get(baseline_tier or "fair")
                if tier is None:
                    raise ValueError("invalid baseline_tier")
                after_preview["stability"] = tier["stability"]
                after_preview["difficulty"] = tier["difficulty"]
                after_preview["schedule_source"] = (
                    SCHEDULE_UNINITIALIZED if not tier["initialized"] else SCHEDULE_CALIBRATED
                )
            preview_rows.append(
                {"node_uid": uid, "before": before, "after": after_preview}
            )
            continue

        if row is None:
            row = ReviewNodeState(palace_id=palace_id, node_uid=uid)
            session.add(row)
            states[uid] = row
        if mode == "align_wave":
            remove_node_from_open_waves(session, row)
            raw = row.raw_due_at or row.due_at or utc_now_naive()
            assign_node_to_formal_wave(
                session,
                row,
                raw_due_at=raw,
                reason="calibrated_align",
                force_new_day=target_day,
            )
            row.schedule_source = SCHEDULE_CALIBRATED
            row.schedule_reason = "align_wave"
            # Preserve S/D
        else:
            tier_key = baseline_tier or "fair"
            tier = BASELINE_TIERS.get(tier_key)
            if tier is None:
                raise ValueError("invalid baseline_tier")
            if not tier["initialized"]:
                remove_node_from_open_waves(session, row)
                row.stability = None
                row.difficulty = None
                row.last_review_at = None
                row.raw_due_at = None
                row.effective_wave_id = None
                row.effective_local_date = None
                row.schedule_source = SCHEDULE_UNINITIALIZED
                row.schedule_reason = "baseline_new"
            else:
                row.stability = float(tier["stability"])
                row.difficulty = float(tier["difficulty"])
                row.state = int(State.Review)
                row.step = None
                now = utc_now_naive()
                if row.last_review_at is None:
                    row.last_review_at = now
                # Place due at stability horizon from last review.
                from datetime import timedelta

                raw = row.last_review_at + timedelta(days=float(tier["stability"]))
                assign_node_to_formal_wave(
                    session,
                    row,
                    raw_due_at=raw,
                    reason="calibrated_baseline",
                )
                row.schedule_source = SCHEDULE_CALIBRATED
                row.schedule_reason = f"baseline_{tier_key}"
        after = _state_dict(row)
        before_snapshot = {"state": before, "wave_items": before_wave_items}
        before_after.append((uid, before_snapshot, after or {}))
        preview_rows.append({"node_uid": uid, "before": before, "after": after})

    if not confirm:
        return {
            "operation_id": operation_id,
            "preview": True,
            "palace_revision": current_rev,
            "mode": mode,
            "baseline_tier": baseline_tier,
            "target_local_date": target_day.isoformat() if target_day else None,
            "affected_node_count": len(preview_rows),
            "items": preview_rows,
        }

    op = ReviewCalibrationOperation(
        id=operation_id,
        palace_id=palace_id,
        mode=mode,
        scope_kind=scope_kind,
        scope_json=json.dumps(scope or {}, ensure_ascii=False),
        baseline_tier=baseline_tier,
        palace_revision=current_rev,
        preview_only=False,
        affected_node_count=len(before_after),
        created_at=utc_now_naive(),
    )
    session.add(op)
    session.add_all(
        [
            ReviewCalibrationOperationItem(
                operation_id=operation_id,
                palace_id=palace_id,
                node_uid=uid,
                before_state_json=json.dumps(before, ensure_ascii=False) if before else "{}",
                after_state_json=json.dumps(after, ensure_ascii=False),
                created_at=utc_now_naive(),
            )
            for uid, before, after in before_after
        ]
    )
    session.flush()
    _clear_due_rollup_cache(session)
    session.commit()
    return {
        "operation_id": operation_id,
        "preview": False,
        "palace_revision": current_rev,
        "mode": mode,
        "baseline_tier": baseline_tier,
        "target_local_date": target_day.isoformat() if target_day else None,
        "affected_node_count": len(before_after),
        "items": preview_rows,
    }


def undo_calibration(session: Session, *, operation_id: str, palace_id: int) -> dict[str, Any]:
    op = session.get(ReviewCalibrationOperation, operation_id)
    if op is None or op.palace_id != palace_id:
        raise ValueError("calibration operation not found")
    if op.undone_at is not None:
        return {"operation_id": operation_id, "undone": True, "idempotent": True}
    newer = (
        session.query(ReviewCalibrationOperation)
        .filter(
            ReviewCalibrationOperation.palace_id == palace_id,
            ReviewCalibrationOperation.created_at > op.created_at,
            ReviewCalibrationOperation.undone_at.is_(None),
            ReviewCalibrationOperation.preview_only == False,  # noqa: E712
        )
        .first()
    )
    if newer is not None:
        raise ValueError("only the latest calibration operation can be undone")
    items = (
        session.query(ReviewCalibrationOperationItem)
        .filter(ReviewCalibrationOperationItem.operation_id == operation_id)
        .all()
    )
    from memory_anki.modules.reviews.application.node_memory_projection import _restore_state

    for item in items:
        snapshot = json.loads(item.before_state_json or "null")
        if isinstance(snapshot, dict) and "state" in snapshot:
            state_snapshot = snapshot.get("state")
            wave_snapshots = snapshot.get("wave_items") or []
        else:
            state_snapshot = None if snapshot == {} else snapshot
            wave_snapshots = []
        _restore_state(session, palace_id, item.node_uid, state_snapshot)
        _restore_open_wave_items(
            session,
            palace_id=palace_id,
            node_uid=item.node_uid,
            snapshots=wave_snapshots,
        )
    op.undone_at = utc_now_naive()
    session.flush()
    _clear_due_rollup_cache(session)
    session.commit()
    return {"operation_id": operation_id, "undone": True, "affected_node_count": len(items)}
