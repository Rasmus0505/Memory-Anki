"""Subject memory ladder is a read-only stage map, not a second scheduler."""

from __future__ import annotations

import json
from datetime import date

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, palace_subject_table
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.application.subject_memory_ladder import (
    get_subject_memory_ladder,
)

TODAY = date(2026, 8, 12)


def _palace(session, title: str, *, archived: bool = False, deleted: bool = False) -> Palace:
    palace = Palace(
        title=title,
        editor_doc="{}",
        archived=archived,
        deleted_at=utc_now_naive() if deleted else None,
    )
    session.add(palace)
    session.flush()
    return palace


def _unit(
    session,
    palace_id: int,
    unit_id: str,
    stage_index: int,
    due: date,
    *,
    active: bool = True,
) -> None:
    session.add(
        ReviewUnitState(
            id=unit_id,
            palace_id=palace_id,
            anchor_uid=unit_id,
            unit_kind="mark",
            node_uids_json="[]",
            membership_hash=unit_id,
            content_hash=unit_id,
            revision=1,
            stage_index=stage_index,
            has_passed=stage_index > 0,
            due_date=due,
            active=active,
        )
    )


def _link(session, palace_id: int, subject_id: int) -> None:
    session.execute(
        palace_subject_table.insert().values(palace_id=palace_id, subject_id=subject_id)
    )


def _subject(session, name: str, *, sort_order: int = 0, color: str = "#336699") -> Subject:
    subject = Subject(name=name, color=color, sort_order=sort_order)
    session.add(subject)
    session.flush()
    return subject


def test_subject_ladder_groups_stages_without_writing(db_session):
    history = _subject(db_session, "中国教育史", sort_order=1, color="#2255aa")
    english = _subject(db_session, "英语", sort_order=0, color="#228855")
    _subject(db_session, "空学科", sort_order=2)
    shared = _palace(db_session, "共同宫殿")
    early = _palace(db_session, "早复习")
    later = _palace(db_session, "晚复习")
    archived = _palace(db_session, "已归档", archived=True)
    unassigned = _palace(db_session, "未归类")
    _link(db_session, shared.id, history.id)
    _link(db_session, shared.id, english.id)
    _link(db_session, early.id, history.id)
    _link(db_session, later.id, history.id)
    _link(db_session, archived.id, history.id)
    _unit(db_session, shared.id, "shared-learn", 0, date(2026, 8, 1))
    _unit(db_session, shared.id, "shared-week", 3, date(2026, 8, 20))
    _unit(db_session, shared.id, "shared-week-later", 3, date(2026, 8, 28))
    _unit(db_session, early.id, "early-week", 3, date(2026, 8, 11))
    _unit(db_session, later.id, "later-week", 3, date(2026, 8, 12))
    _unit(db_session, later.id, "inactive", 3, date(2026, 8, 1), active=False)
    _unit(db_session, archived.id, "archived", 5, date(2026, 8, 1))
    _unit(db_session, unassigned.id, "loose", 1, TODAY)
    db_session.commit()
    before = db_session.query(ReviewUnitState).count()

    payload = get_subject_memory_ladder(db_session, today=TODAY)

    assert db_session.query(ReviewUnitState).count() == before
    assert not db_session.new
    assert not db_session.dirty
    assert payload["ladder"] == [0, 1, 3, 7, 14, 30, 60, 120, 240, 365]
    assert [item["name"] for item in payload["subjects"]] == ["英语", "中国教育史", "空学科", "未分类"]

    english_item = payload["subjects"][0]
    assert english_item["palace_count"] == 1
    assert english_item["stages"][0]["palace_count"] == 1
    assert english_item["stages"][3]["palaces"][0]["due_date"] == "2026-08-20"
    assert english_item["stages"][3]["palaces"][0]["unit_count"] == 2

    history_item = payload["subjects"][1]
    week = history_item["stages"][3]
    assert [palace["title"] for palace in week["palaces"]] == ["早复习", "晚复习", "共同宫殿"]
    assert week["palaces"][0]["overdue"] is True
    assert week["palaces"][0]["due_date"] == "2026-08-11"
    assert week["palaces"][1]["due_today"] is True
    assert week["palaces"][1]["overdue"] is False
    assert week["overdue_palace_count"] == 1
    assert week["unit_count"] == 4
    assert all(stage["palace_count"] == 0 for stage in history_item["stages"] if stage["stage_index"] == 5)
    assert payload["subjects"][2]["palace_count"] == 0
    assert len(payload["subjects"][2]["stages"]) == 10
    assert payload["subjects"][3]["subject_id"] is None
    assert payload["subjects"][3]["stages"][1]["palaces"][0]["title"] == "未归类"


def test_subject_ladder_does_not_reconcile_unprojected_marks(db_session):
    palace = Palace(
        title="未对账",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "未对账", "permanentSplitMark": True},
                    "children": [{"data": {"uid": "node-a", "text": "节点"}, "children": []}],
                }
            },
            ensure_ascii=False,
        ),
    )
    db_session.add(palace)
    db_session.commit()

    payload = get_subject_memory_ladder(db_session, today=TODAY)

    assert db_session.query(ReviewUnitState).count() == 0
    assert payload["subjects"] == []


def test_subject_ladder_http_endpoint(session_factory, make_client, db_session):
    from memory_anki.modules.memory.presentation import router as review_router

    subject = _subject(db_session, "生物", sort_order=0)
    palace = _palace(db_session, "细胞")
    _link(db_session, palace.id, subject.id)
    _unit(db_session, palace.id, "cell", 2, date(2026, 8, 30))
    db_session.commit()

    client = make_client(review_router)
    response = client.get("/api/v1/review/subject-ladder")

    assert response.status_code == 200
    body = response.json()
    assert body["ladder"][2] == 3
    assert body["subjects"][0]["name"] == "生物"
    assert body["subjects"][0]["stages"][2]["palaces"][0]["title"] == "细胞"
