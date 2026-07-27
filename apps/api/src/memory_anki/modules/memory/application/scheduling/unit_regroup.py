"""Preview, execute, and rollback scheduling-unit regroup operations."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewCalibrationOperation,
    ReviewCalibrationOperationItem,
    ReviewNodeState,
)
from memory_anki.modules.memory.application.calibration_service import _palace_revision
from memory_anki.modules.memory.application.node_memory_projection import (
    _restore_state,
    _state_dict,
)
from memory_anki.modules.memory.application.scheduling.aggregation import (
    apply_unit_aggregation,
    compute_unit_aggregation,
)
from memory_anki.modules.memory.application.scheduling.units import resolve_units

MODE = "unit_regroup"

def preview_unit_regroup(session: Session, *, palace_id: int, unit_root_uid: str | None = None) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    units = resolve_units(session, palace_id)
    selected = [units[unit_root_uid]] if unit_root_uid and unit_root_uid in units else list(units.values())
    previews = [compute_unit_aggregation(session, palace_id=palace_id, unit_root_uid=unit.unit_root_uid) for unit in selected]
    moves = [move for preview in previews for move in preview.moves]
    return {
        "palace_id": palace_id, "palace_revision": _palace_revision(palace),
        "unit_count": len(previews), "move_count": len(moves),
        "wave_count": sum(len(item.waves) for item in previews),
        "consolidate_count": sum(len(item.consolidate_node_uids) for item in previews),
        "units": [{
            "unit_root_uid": item.unit_root_uid,
            "wave_count": len(item.waves),
            "move_count": len(item.moves),
            "consolidate_count": len(item.consolidate_node_uids),
            "day_counts_before": item.day_counts_before, "day_counts_after": item.day_counts_after,
        } for item in previews],
    }

def execute_unit_regroup(session: Session, *, palace_id: int, operation_id: str, palace_revision: str, unit_root_uid: str | None = None) -> dict[str, Any]:
    if not operation_id.strip():
        raise ValueError("operation_id required")
    if session.get(ReviewCalibrationOperation, operation_id) is not None:
        raise ValueError("operation_id already used")
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    current_revision = _palace_revision(palace)
    if palace_revision != current_revision:
        raise ValueError("palace revision conflict; refresh and retry")
    units = resolve_units(session, palace_id)
    selected = [units[unit_root_uid]] if unit_root_uid and unit_root_uid in units else list(units.values())
    previews = [compute_unit_aggregation(session, palace_id=palace_id, unit_root_uid=unit.unit_root_uid) for unit in selected]
    affected = {uid for preview in previews for wave in preview.waves for uid in wave.node_uids} | {uid for preview in previews for uid in preview.consolidate_node_uids}
    rows = {row.node_uid: row for row in session.query(ReviewNodeState).filter(ReviewNodeState.palace_id == palace_id, ReviewNodeState.node_uid.in_(affected)).all()}
    before = {uid: _state_dict(rows.get(uid)) for uid in affected}
    operation = ReviewCalibrationOperation(id=operation_id, palace_id=palace_id, mode=MODE, scope_kind="nodes", scope_json=json.dumps({"unit_root_uid": unit_root_uid}), palace_revision=current_revision, preview_only=False, affected_node_count=len(affected))
    session.add(operation)
    session.flush()
    applied = sum(apply_unit_aggregation(session, palace_id=palace_id, preview=preview) for preview in previews)
    session.flush()
    after_rows = {row.node_uid: row for row in session.query(ReviewNodeState).filter(ReviewNodeState.palace_id == palace_id, ReviewNodeState.node_uid.in_(affected)).all()}
    for uid in sorted(affected):
        session.add(ReviewCalibrationOperationItem(operation_id=operation_id, palace_id=palace_id, node_uid=uid, before_state_json=json.dumps(before.get(uid), ensure_ascii=False), after_state_json=json.dumps(_state_dict(after_rows.get(uid)), ensure_ascii=False)))
    session.commit()
    return {"operation_id": operation_id, "palace_revision": current_revision, "affected_node_count": applied}

def rollback_unit_regroup(session: Session, *, operation_id: str) -> dict[str, Any]:
    operation = session.get(ReviewCalibrationOperation, operation_id)
    if operation is None or operation.mode != MODE:
        raise ValueError("unit regroup operation not found")
    if operation.undone_at is not None:
        raise ValueError("unit regroup operation already rolled back")
    items = session.query(ReviewCalibrationOperationItem).filter_by(operation_id=operation_id).all()
    for item in items:
        _restore_state(session, item.palace_id, item.node_uid, json.loads(item.before_state_json))
    operation.undone_at = utc_now_naive()
    session.commit()
    return {"operation_id": operation_id, "restored_node_count": len(items)}

def simulate_cohesion(session: Session, *, palace_id: int, unit_root_uid: str | None = None) -> dict[str, Any]:
    return preview_unit_regroup(session, palace_id=palace_id, unit_root_uid=unit_root_uid)
