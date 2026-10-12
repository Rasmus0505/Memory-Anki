import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import list_palace_ids_without_units
from memory_anki.modules.practice.application.queue_service import build_freestyle_queue


@pytest.fixture()
def session(db_session):
    return db_session


def _unreconciled_palace(session) -> Palace:
    palace = Palace(
        title="未 reconcile 的宫殿",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "未 reconcile 的宫殿", "permanentSplitMark": True},
                    "children": [{"data": {"uid": "node-a", "text": "节点 A"}, "children": []}],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(palace)
    session.commit()
    return palace


def test_palace_without_unit_rows_is_listed_then_enters_queue(session) -> None:
    palace = _unreconciled_palace(session)
    assert session.query(ReviewUnitState).filter_by(palace_id=palace.id).count() == 0
    assert list_palace_ids_without_units(session) == [palace.id]

    result = build_freestyle_queue(
        session,
        config_raw={"training_mode": "memory_palace"},
        operation_id="op-unreconciled",
    )
    session.commit()

    assert result["round_meta"]["candidate_count"] >= 1
    assert session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).count() >= 1
    assert list_palace_ids_without_units(session) == []


def test_reconciled_palace_is_not_listed_again(session) -> None:
    from memory_anki.modules.memory.api import reconcile_palace_units

    palace = _unreconciled_palace(session)
    reconcile_palace_units(session, palace.id)
    session.commit()

    assert list_palace_ids_without_units(session) == []
    assert list_palace_ids_without_units(session, []) == []
