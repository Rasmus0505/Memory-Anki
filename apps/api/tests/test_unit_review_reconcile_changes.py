"""Reconcile change diffs, manual schedule adjust, and schedule batch undo."""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import local_day
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
    unit.due_date = local_day() + timedelta(days=30)
    unit.revision += 1
    session.commit()
    return unit


def test_reconcile_content_change_preserves_schedule_without_batch(db_session):
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
    updates = [item for item in result["changes"] if item["action"] == "content_updated"]
    assert len(updates) == 1
    change = updates[0]
    assert change["unit_id"] == unit.id
    assert change["before"]["stage_index"] == before_stage
    assert change["before"]["due_date"] == before_due.isoformat()
    assert change["after"] == change["before"]
    assert result["undo_token"] is None
    assert result["schedule_batch_id"] is None
    assert db_session.query(ReviewUnitScheduleBatch).count() == 0
    assert unit.stage_index == before_stage
    assert unit.due_date == before_due
    assert unit.content_hash != content_hash_before


def _legacy_demotion_batch(session, unit):
    """Previously persisted batches remain undoable; new edits never create one."""
    from uuid import uuid4

    before = {
        "stage_index": unit.stage_index,
        "due_date": unit.due_date.isoformat(),
        "has_passed": unit.has_passed,
    }
    unit.stage_index = max(0, unit.stage_index - 1)
    unit.due_date = local_day()
    batch = ReviewUnitScheduleBatch(
        id=uuid4().hex, palace_id=unit.palace_id, reason="content_reconcile",
        entries_json=json.dumps([{"unit_id": unit.id, "before": before}]),
    )
    session.add(batch)
    session.flush()
    return batch.id


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
    assert result["undo_token"] is None
    token = _legacy_demotion_batch(db_session, unit)

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


def _sibling_doc() -> str:
    return json.dumps(
        {
            "root": {
                "data": {"uid": "A", "text": "A", "memoryAnkiRootKind": "palace"},
                "children": [
                    {
                        "data": {"uid": "B1", "text": "B1", "permanentSplitMark": True},
                        "children": [
                            {"data": {"uid": "C1", "text": "C1"}, "children": []},
                        ],
                    },
                    {
                        "data": {"uid": "B2", "text": "B2", "permanentSplitMark": True},
                        "children": [
                            {"data": {"uid": "C2", "text": "C2"}, "children": []},
                        ],
                    },
                ],
            }
        },
        ensure_ascii=False,
    )


def test_sibling_marks_keep_their_own_schedules_without_a_cohort(db_session):
    palace = Palace(title="兄弟标记", archived=False, editor_doc=_sibling_doc())
    db_session.add(palace)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    marks = {row.anchor_uid: row for row in _active_rows(db_session, palace.id)}
    assert {(row.unit_kind, row.anchor_uid) for row in marks.values()} == {
        ("mark", "B1"),
        ("mark", "B2"),
    }
    early = local_day() + timedelta(days=10)
    late = local_day() + timedelta(days=40)
    marks["B1"].stage_index = 4
    marks["B1"].has_passed = True
    marks["B1"].due_date = late
    marks["B2"].stage_index = 2
    marks["B2"].has_passed = True
    marks["B2"].due_date = early
    ids = {anchor: row.id for anchor, row in marks.items()}
    db_session.commit()

    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    assert [item for item in result["changes"] if item["action"] == "created"] == []
    b1 = db_session.get(ReviewUnitState, ids["B1"])
    b2 = db_session.get(ReviewUnitState, ids["B2"])
    assert (b1.active, b1.stage_index, b1.due_date) == (True, 4, late)
    assert (b2.active, b2.stage_index, b2.due_date) == (True, 2, early)


def test_legacy_cohort_row_is_retired_and_marks_keep_their_schedules(db_session):
    """A stored cohort from before the kind was removed must not speak for its marks."""
    palace = Palace(title="遗留卡", archived=False, editor_doc=_sibling_doc())
    db_session.add(palace)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    marks = {row.anchor_uid: row for row in _active_rows(db_session, palace.id)}
    late = local_day() + timedelta(days=40)
    marks["B1"].stage_index = 5
    marks["B1"].has_passed = True
    marks["B1"].due_date = late
    b1_id = marks["B1"].id
    db_session.add(
        ReviewUnitState(
            id="legacy-cohort",
            palace_id=palace.id,
            anchor_uid="A",
            unit_kind="cohort",
            node_uids_json=json.dumps(["B1", "B2"]),
            membership_hash="legacy",
            content_hash="legacy",
            revision=1,
            stage_index=0,
            has_passed=False,
            due_date=local_day(),
            topology_order=0,
            active=True,
        )
    )
    db_session.commit()

    reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    legacy = db_session.get(ReviewUnitState, "legacy-cohort")
    assert legacy is not None and legacy.active is False
    assert not [row for row in _active_rows(db_session, palace.id) if row.unit_kind == "cohort"]
    b1 = db_session.get(ReviewUnitState, b1_id)
    assert (b1.active, b1.stage_index, b1.due_date) == (True, 5, late)


def test_list_due_units_reconciles_content_hash_lag_without_leave(db_session):
    """Mid-edit kill: reconcile lagging hashes without changing earned progress."""
    from memory_anki.modules.memory.api import list_due_units

    unit = _seed(db_session, stage_index=3)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    # Make unit due today, then mutate editor_doc without reconcile (kill mid-edit).
    unit.due_date = local_day()
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
    assert unit.stage_index == stage_before
    assert unit.due_date == local_day()

    matched = [item for item in items if item["id"] == unit.id]
    assert len(matched) == 1
    assert matched[0]["stage_index"] == stage_before
    assert matched[0]["due"] is True


def test_get_palace_unit_projection_reconciles_hash_lag_for_freestyle(db_session):
    """Write-side projection reconciles content without bringing future work due."""
    from memory_anki.modules.memory.api import get_palace_unit_projection

    unit = _seed(db_session, stage_index=4)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None
    assert unit.due_date > local_day()
    hash_before = unit.content_hash
    stage_before = unit.stage_index

    palace.editor_doc = _doc(text="节点 A freestyle 前未 leave")
    db_session.commit()

    due_before = unit.due_date
    projection = get_palace_unit_projection(db_session, palace.id, allow_reconcile=True)
    db_session.commit()

    unit = db_session.get(ReviewUnitState, unit.id)
    assert unit is not None
    assert unit.content_hash != hash_before
    assert unit.stage_index == stage_before
    assert unit.due_date == due_before
    assert projection["due_unit_count"] == 0
    projected = next(item for item in projection["units"] if item["id"] == unit.id)
    assert projected["due"] is False
    assert projected["stage_index"] == stage_before


def test_adjust_unit_schedule_updates_fields_without_content_hash(db_session):
    unit = _seed(db_session, stage_index=2)
    content_hash = unit.content_hash
    membership_hash = unit.membership_hash
    revision = unit.revision
    target_due = local_day() + timedelta(days=14)

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


def test_direct_schedule_adjustment_leaves_http_replay_to_adapter(db_session):
    unit = _seed(db_session, stage_index=1)
    adjust_unit_schedule(
        db_session,
        unit_id=unit.id,
        operation_id="manual-op-replay",
        stage_index=5,
    )
    db_session.commit()
    revision = db_session.get(ReviewUnitState, unit.id).revision

    replay = adjust_unit_schedule(
        db_session,
        unit_id=unit.id,
        operation_id="manual-op-replay",
        stage_index=0,
    )

    assert replay["after"]["stage_index"] == 0
    persisted = db_session.get(ReviewUnitState, unit.id)
    assert persisted is not None
    assert persisted.stage_index == 0
    assert persisted.revision == revision + 1


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
            "due_date": local_day().isoformat(),
            "has_passed": False,
            "reason": "manual_adjust",
        },
    )
    assert adjusted.status_code == 200
    body = adjusted.json()["item"]
    assert body["unit"]["stage_index"] == 1
    assert body["unit"]["due_date"] == local_day().isoformat()
    assert body["unit"]["has_passed"] is False
    assert body["operation_id"] == "http-adjust-1"

    replay = client.patch(
        f"/api/v1/review/units/{unit_id}/schedule",
        headers={"X-Memory-Anki-Mutation-ID": "http-adjust-replay"},
        json={
            "operation_id": "http-adjust-replay",
            "stage_index": 6,
        },
    )
    assert replay.status_code == 200
    replay_again = client.patch(
        f"/api/v1/review/units/{unit_id}/schedule",
        headers={"X-Memory-Anki-Mutation-ID": "http-adjust-replay"},
        json={
            "operation_id": "http-adjust-replay",
            "stage_index": 0,
        },
    )
    assert replay_again.status_code == 200
    assert replay_again.json() == replay.json()
    wrong_unit = client.patch(
        "/api/v1/review/units/another-unit/schedule",
        headers={"X-Memory-Anki-Mutation-ID": "http-adjust-replay"},
        json={"operation_id": "http-adjust-replay", "stage_index": 0},
    )
    assert wrong_unit.status_code == 400

    body_replay = client.patch(
        f"/api/v1/review/units/{unit_id}/schedule",
        json={"operation_id": "http-adjust-1", "stage_index": 0},
    )
    assert body_replay.status_code == 200
    assert body_replay.json() == adjusted.json()

    with session_factory() as session:
        unit = session.get(ReviewUnitState, unit_id)
        assert unit is not None
        assert unit.stage_index == 6

    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace is not None
        palace.editor_doc = _doc(text="节点 A HTTP 改写")
        session.commit()
        result = reconcile_palace_units(session, palace_id)
        session.commit()
        assert result["undo_token"] is None
        unit = session.get(ReviewUnitState, unit_id)
        assert unit is not None
        batch_id = _legacy_demotion_batch(session, unit)
        session.commit()

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
        # Undo restores the schedule present immediately before reconciliation.
        assert unit.stage_index == 6
        assert unit.due_date.isoformat() == local_day().isoformat()
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


# --- Permanent-mark changes must carry review progress over, never restart it ---
#
# Deleting the final permanent mark deactivates every unit row but leaves the
# earned stage/due on disk. Re-marking used to read only active rows, find no
# overlap, and restart at first-learning -- silently discarding a ladder
# position that was still stored. These tests pin the carry-over contract.


def _marked_branch_doc(*, mark_a: bool, deeper: bool = False) -> str:
    """Unmarked root; the only permanent mark sits on A (or deeper on A1).

    The root is deliberately left unmarked so removing A's mark removes the
    palace's final mark and deactivates every unit.
    """
    a1 = {"uid": "a1", "text": "A1"}
    if deeper:
        a1["permanentSplitMark"] = True
    a = {"uid": "a", "text": "A"}
    if mark_a:
        a["permanentSplitMark"] = True
    return json.dumps(
        {
            "root": {
                "data": {
                    "uid": "root",
                    "text": "P",
                    "memoryAnkiRootKind": "palace",
                },
                "children": [{"data": a, "children": [{"data": a1, "children": []}]}],
            }
        },
        ensure_ascii=False,
    )


def _earned_palace(session, doc: str, *, stage: int = 6, days: int = 60):
    palace = Palace(title="P", archived=False, editor_doc=doc)
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    due = local_day() + timedelta(days=days)
    for row in session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True):
        row.stage_index = stage
        row.has_passed = True
        row.due_date = due
    session.commit()
    return palace, due


def _active_rows(session, palace_id):
    return (
        session.query(ReviewUnitState)
        .filter_by(palace_id=palace_id, active=True)
        .order_by(ReviewUnitState.topology_order)
        .all()
    )


def test_remark_after_deleting_every_mark_keeps_earned_schedule(db_session):
    """Delete the final mark, then re-add it: stage and due date come back."""
    palace, due = _earned_palace(db_session, _marked_branch_doc(mark_a=True))
    initial = _active_rows(db_session, palace.id)
    assert initial
    original_ids = {row.id for row in initial}

    # Remove the only mark: every unit deactivates, schedule stays on disk.
    palace.editor_doc = _marked_branch_doc(mark_a=False)
    db_session.commit()
    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    assert result["mark_required"] is True
    assert _active_rows(db_session, palace.id) == []

    # Re-add the same mark. Nothing active owned the region, so the previous
    # incarnation is reactivated with its earned stage and due date intact.
    palace.editor_doc = _marked_branch_doc(mark_a=True)
    db_session.commit()
    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    rows = _active_rows(db_session, palace.id)
    assert rows
    # The same rows come back rather than fresh ones, so unit identity, rating
    # history and the earned schedule stay attached to the original records.
    assert {row.id for row in rows} == original_ids
    assert all(
        item["action"] == "reactivated" for item in result["changes"]
    ), result["changes"]
    for row in rows:
        assert (row.stage_index, row.due_date) == (6, due), (
            f"{row.anchor_uid}/{row.unit_kind} restarted instead of inheriting"
        )
        assert row.has_passed is True


def test_remark_at_a_different_anchor_inherits_by_node_overlap(db_session):
    """Mark moves A -> A1: same studied region, so progress follows the content."""
    palace, due = _earned_palace(db_session, _marked_branch_doc(mark_a=True))

    # Delete, then re-add one level deeper so the anchor uid differs.
    palace.editor_doc = _marked_branch_doc(mark_a=False)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    palace.editor_doc = _marked_branch_doc(mark_a=False, deeper=True)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    deeper = [
        row for row in _active_rows(db_session, palace.id) if row.anchor_uid == "a1"
    ]
    assert deeper, "expected the deeper mark to create a unit"
    assert (deeper[0].stage_index, deeper[0].due_date) == (6, due)
    assert deeper[0].has_passed is True
