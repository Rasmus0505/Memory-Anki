"""Reconcile change diffs, manual schedule adjust, and schedule batch undo."""

from __future__ import annotations

import json
from datetime import date, timedelta

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitScheduleBatch,
    ReviewUnitState,
)
from memory_anki.modules.memory.api import (
    adjust_unit_schedule,
    reconcile_palace_units,
    undo_content_schedule_batch,
)
from memory_anki.modules.memory.application.unit_scheduler import INTERVAL_DAYS


def _doc(*, text: str = "节点 A", mark: bool = True) -> str:
    root = {
        "uid": "root",
        "text": "变更记录宫殿",
        "memoryAnkiRootKind": "palace",
    }
    if mark:
        root["permanentSplitMark"] = True
    return json.dumps(
        {
            "root": {
                "data": root,
                "children": [
                    {"data": {"uid": "node-a", "text": text}, "children": []},
                ],
            }
        },
        ensure_ascii=False,
    )


def _seed(session, *, stage_index: int = 3) -> ReviewUnitState:
    palace = Palace(
        title="变更记录宫殿",
        archived=False,
        editor_doc=_doc(),
    )
    session.add(palace)
    session.commit()
    result = reconcile_palace_units(session, palace.id)
    session.commit()
    assert result["unit_count"] == 1
    unit = session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()
    unit.stage_index = stage_index
    unit.has_passed = True
    unit.due_date = date.today() + timedelta(days=30)
    unit.revision += 1
    session.commit()
    return unit


def test_reconcile_content_change_returns_demotion_and_batch(db_session):
    unit = _seed(db_session, stage_index=3)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None
    before_stage = unit.stage_index
    before_due = unit.due_date
    content_hash_before = unit.content_hash

    palace.editor_doc = _doc(text="节点 A 内容已改")
    db_session.commit()
    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    demotions = [item for item in result["changes"] if item["action"] == "content_demoted"]
    assert len(demotions) == 1
    change = demotions[0]
    assert change["unit_id"] == unit.id
    assert change["before"]["stage_index"] == before_stage
    assert change["before"]["due_date"] == before_due.isoformat()
    assert change["after"]["stage_index"] == before_stage - 1
    assert change["after"]["due_date"] == date.today().isoformat()
    assert result["undo_token"] == result["schedule_batch_id"]
    assert result["undo_token"]
    batch = db_session.get(ReviewUnitScheduleBatch, result["undo_token"])
    assert batch is not None
    assert batch.reason == "content_reconcile"
    assert batch.undone_at is None
    assert unit.stage_index == before_stage - 1
    assert unit.due_date == date.today()
    assert unit.content_hash != content_hash_before


def test_undo_content_schedule_batch_restores_schedule_not_content_hash(db_session):
    unit = _seed(db_session, stage_index=4)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None
    before_stage = unit.stage_index
    before_due = unit.due_date
    before_passed = unit.has_passed

    palace.editor_doc = _doc(text="节点 A 再次改写")
    db_session.commit()
    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    demoted_hash = unit.content_hash
    demoted_revision = unit.revision
    token = result["undo_token"]
    assert token

    undo = undo_content_schedule_batch(db_session, token)
    db_session.commit()
    unit = db_session.get(ReviewUnitState, unit.id)
    batch = db_session.get(ReviewUnitScheduleBatch, token)
    assert unit is not None
    assert batch is not None
    assert undo["restored_count"] == 1
    assert unit.stage_index == before_stage
    assert unit.due_date == before_due
    assert unit.has_passed is before_passed
    assert unit.content_hash == demoted_hash
    assert unit.revision == demoted_revision + 1
    assert batch.undone_at is not None


def test_membership_change_reports_membership_updated(db_session):
    unit = _seed(db_session, stage_index=2)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    # Add a second permanent mark that carves a new unit from the residual.
    palace.editor_doc = json.dumps(
        {
            "root": {
                "data": {
                    "uid": "root",
                    "text": "变更记录宫殿",
                    "memoryAnkiRootKind": "palace",
                    "permanentSplitMark": True,
                },
                "children": [
                    {
                        "data": {
                            "uid": "node-a",
                            "text": "节点 A",
                            "permanentSplitMark": True,
                        },
                        "children": [],
                    },
                    {
                        "data": {"uid": "node-b", "text": "节点 B"},
                        "children": [],
                    },
                ],
            }
        },
        ensure_ascii=False,
    )
    db_session.commit()
    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    actions = {item["action"] for item in result["changes"]}
    assert "created" in actions or "membership_updated" in actions
    assert result["unit_count"] >= 1
    assert result.get("undo_token") is None or not any(
        item["action"] == "content_demoted" for item in result["changes"]
    )


def test_list_due_units_reconciles_content_hash_lag_without_leave(db_session):
    """Mid-edit kill: editor_doc advanced, unit hashes lag, unit still due → demote."""
    from memory_anki.modules.memory.api import list_due_units

    unit = _seed(db_session, stage_index=3)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    # Make unit due today, then mutate editor_doc without reconcile (kill mid-edit).
    unit.due_date = date.today()
    unit.stage_index = 3
    hash_before = unit.content_hash
    stage_before = unit.stage_index
    db_session.commit()

    palace.editor_doc = _doc(text="节点 A 杀进程未 reconcile")
    db_session.commit()

    # Stored hash still lagging.
    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.content_hash == hash_before

    items = list_due_units(db_session)
    db_session.commit()

    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.content_hash != hash_before
    assert unit.stage_index == stage_before - 1
    assert unit.due_date == date.today()

    matched = [item for item in items if item["id"] == unit.id]
    assert len(matched) == 1
    assert matched[0]["stage_index"] == stage_before - 1
    assert matched[0]["due"] is True


def test_get_palace_unit_projection_reconciles_hash_lag_for_freestyle(db_session):
    """Freestyle queue path uses projection; lag must demote even if not yet due."""
    from memory_anki.modules.memory.api import get_palace_unit_projection

    unit = _seed(db_session, stage_index=4)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None
    assert unit.due_date > date.today()
    hash_before = unit.content_hash
    stage_before = unit.stage_index

    palace.editor_doc = _doc(text="节点 A freestyle 前未 leave")
    db_session.commit()

    projection = get_palace_unit_projection(db_session, palace.id)
    db_session.commit()

    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.content_hash != hash_before
    assert unit.stage_index == stage_before - 1
    assert unit.due_date == date.today()
    assert projection["due_unit_count"] == 1
    projected = next(item for item in projection["units"] if item["id"] == unit.id)
    assert projected["due"] is True
    assert projected["stage_index"] == stage_before - 1


def test_adjust_unit_schedule_updates_fields_without_content_hash(db_session):
    unit = _seed(db_session, stage_index=2)
    content_hash = unit.content_hash
    membership_hash = unit.membership_hash
    revision = unit.revision
    target_due = date.today() + timedelta(days=14)

    result = adjust_unit_schedule(
        db_session,
        unit_id=unit.id,
        operation_id="manual-op-1",
        stage_index=5,
        due_date=target_due.isoformat(),
        has_passed=False,
        reason="manual_adjust",
    )
    db_session.commit()

    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.stage_index == 5
    assert unit.due_date == target_due
    assert unit.has_passed is False
    assert unit.content_hash == content_hash
    assert unit.membership_hash == membership_hash
    assert unit.revision == revision + 1
    assert result["operation_id"] == "manual-op-1"
    assert result["unit"]["stage_index"] == 5
    assert result["unit"]["interval_days"] == INTERVAL_DAYS[5]
    assert result["palace"]["palace_id"] == unit.palace_id
    assert result["before"]["stage_index"] == 2
    assert result["after"]["stage_index"] == 5


def test_adjust_unit_schedule_clamps_stage_and_requires_operation_id(db_session):
    unit = _seed(db_session, stage_index=1)
    result = adjust_unit_schedule(
        db_session,
        unit_id=unit.id,
        operation_id="manual-op-clamp",
        stage_index=99,
    )
    db_session.commit()
    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.stage_index == len(INTERVAL_DAYS) - 1
    assert result["after"]["stage_index"] == len(INTERVAL_DAYS) - 1

    try:
        adjust_unit_schedule(db_session, unit_id=unit.id, operation_id="", stage_index=0)
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_adjust_and_undo_schedule_http_endpoints(session_factory, make_client):
    from memory_anki.modules.memory.presentation import router as review_router

    with session_factory() as session:
        unit = _seed(session, stage_index=4)
        unit_id = unit.id
        palace_id = unit.palace_id
        before_stage = unit.stage_index
        before_due = unit.due_date.isoformat()
        before_passed = unit.has_passed

    client = make_client(review_router)

    projection = client.get(f"/api/v1/review/palaces/{palace_id}/units")
    assert projection.status_code == 200
    assert projection.json()["item"]["unit_count"] == 1

    adjusted = client.patch(
        f"/api/v1/review/units/{unit_id}/schedule",
        json={
            "operation_id": "http-adjust-1",
            "stage_index": 1,
            "due_date": date.today().isoformat(),
            "has_passed": False,
            "reason": "manual_adjust",
        },
    )
    assert adjusted.status_code == 200
    body = adjusted.json()["item"]
    assert body["unit"]["stage_index"] == 1
    assert body["unit"]["due_date"] == date.today().isoformat()
    assert body["unit"]["has_passed"] is False
    assert body["operation_id"] == "http-adjust-1"

    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace is not None
        palace.editor_doc = _doc(text="节点 A HTTP 改写")
        session.commit()
        result = reconcile_palace_units(session, palace_id)
        session.commit()
        batch_id = result["undo_token"]
        assert batch_id

    undo = client.post(
        f"/api/v1/review/palaces/{palace_id}/schedule-batches/{batch_id}/undo",
        json={"operation_id": "http-undo-1"},
    )
    assert undo.status_code == 200
    undo_body = undo.json()["item"]
    assert undo_body["restored_count"] == 1
    assert undo_body["operation_id"] == "http-undo-1"
    assert undo_body["batch_id"] == batch_id

    with session_factory() as session:
        unit = session.get(ReviewUnitState, unit_id)
        assert unit is not None
        # Undo restores pre-demotion schedule (post-adjust: stage 1 / today / False).
        assert unit.stage_index == 1
        assert unit.due_date.isoformat() == date.today().isoformat()
        assert unit.has_passed is False
        assert before_stage == 4
        assert before_due
        assert before_passed is True

    # Second undo should fail (already undone).
    again = client.post(
        f"/api/v1/review/palaces/{palace_id}/schedule-batches/{batch_id}/undo",
        json={"operation_id": "http-undo-2"},
    )
    assert again.status_code == 400

    # Wrong palace should fail.
    wrong = client.post(
        f"/api/v1/review/palaces/{palace_id + 999}/schedule-batches/{batch_id}/undo",
        json={},
    )
    assert wrong.status_code == 400
