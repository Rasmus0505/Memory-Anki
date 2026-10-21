"""永久移除: a review unit leaves scheduling for good and never comes back by reconcile."""

from __future__ import annotations

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import (
    get_palace_unit_projection,
    reconcile_palace_units,
    remove_unit_permanently,
)


def _two_marks_doc(*, mark_a: bool = True, mark_b: bool = True, text_b: str = "乙") -> str:
    def child(uid: str, text: str, marked: bool) -> dict:
        data = {"uid": uid, "text": text}
        if marked:
            data["permanentSplitMark"] = True
        return {"data": data, "children": []}

    return json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "永久移除宫殿", "memoryAnkiRootKind": "palace"},
                "children": [child("mark-a", "甲", mark_a), child("mark-b", text_b, mark_b)],
            }
        },
        ensure_ascii=False,
    )


def _single_mark_doc() -> str:
    return json.dumps(
        {
            "root": {
                "data": {
                    "uid": "root",
                    "text": "单单元宫殿",
                    "memoryAnkiRootKind": "palace",
                    "permanentSplitMark": True,
                },
                "children": [{"data": {"uid": "node-a", "text": "节点 A"}, "children": []}],
            }
        },
        ensure_ascii=False,
    )


def _palace(session, editor_doc: str) -> Palace:
    palace = Palace(title="永久移除宫殿", archived=False, editor_doc=editor_doc)
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    return palace


def _active_ids(session, palace_id: int) -> set[str]:
    rows = session.query(ReviewUnitState).filter_by(palace_id=palace_id, active=True).all()
    return {row.id for row in rows}


def test_removed_unit_is_not_scheduled_and_survives_reconcile(db_session):
    palace = _palace(db_session, _two_marks_doc())
    before = _active_ids(db_session, palace.id)
    target_id = db_session.query(ReviewUnitState).filter_by(
        palace_id=palace.id, anchor_uid="mark-a", active=True
    ).one().id
    kept = before - {target_id}
    assert kept

    remove_unit_permanently(db_session, target_id)
    db_session.commit()

    row = db_session.get(ReviewUnitState, target_id)
    assert row is not None
    assert row.active is False
    assert row.permanently_removed is True

    reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    assert _active_ids(db_session, palace.id) == kept


def test_removed_unit_stays_gone_after_its_mark_is_deleted_and_re_added(db_session):
    palace = _palace(db_session, _two_marks_doc())
    target_id = db_session.query(ReviewUnitState).filter_by(
        palace_id=palace.id, anchor_uid="mark-a", active=True
    ).one().id
    remove_unit_permanently(db_session, target_id)
    db_session.commit()

    palace.editor_doc = _two_marks_doc(mark_a=False)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    palace.editor_doc = _two_marks_doc(mark_a=True)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()

    assert target_id not in _active_ids(db_session, palace.id)
    assert all(
        row.anchor_uid != "mark-a" or row.id == target_id
        for row in db_session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True)
    )


def test_removing_twice_is_a_no_op_and_unknown_unit_is_rejected(db_session):
    palace = _palace(db_session, _two_marks_doc())
    target_id = db_session.query(ReviewUnitState).filter_by(
        palace_id=palace.id, anchor_uid="mark-a", active=True
    ).one().id
    first = remove_unit_permanently(db_session, target_id)
    db_session.commit()
    revision = db_session.get(ReviewUnitState, target_id).revision

    second = remove_unit_permanently(db_session, target_id)
    db_session.commit()

    assert second["unit_id"] == first["unit_id"] == target_id
    assert db_session.get(ReviewUnitState, target_id).revision == revision
    with pytest.raises(ValueError, match="review unit not found"):
        remove_unit_permanently(db_session, "no-such-unit")


def test_palace_with_only_removed_units_reads_as_scheduled_not_marking_required(db_session):
    palace = _palace(db_session, _single_mark_doc())
    unit_id = _active_ids(db_session, palace.id).pop()

    remove_unit_permanently(db_session, unit_id)
    db_session.commit()

    projection = get_palace_unit_projection(db_session, palace.id)
    assert projection["unit_count"] == 0
    assert projection["mark_required"] is False
    assert projection["review_status"] == "scheduled"

    result = reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    assert result["mark_required"] is False
    assert result["unit_count"] == 0


def test_remove_permanently_http_endpoint(session_factory, make_client):
    from memory_anki.modules.memory.presentation import router as review_router

    with session_factory() as session:
        palace = _palace(session, _two_marks_doc())
        palace_id = palace.id
        unit_id = session.query(ReviewUnitState).filter_by(
            palace_id=palace_id, anchor_uid="mark-a", active=True
        ).one().id

    client = make_client(review_router)
    response = client.post(f"/api/v1/review/units/{unit_id}/remove-permanently")
    assert response.status_code == 200
    assert response.json()["item"]["unit_id"] == unit_id

    missing = client.post("/api/v1/review/units/no-such-unit/remove-permanently")
    assert missing.status_code == 400

    with session_factory() as session:
        row = session.get(ReviewUnitState, unit_id)
        assert row is not None
        assert row.permanently_removed is True
        assert row.active is False
