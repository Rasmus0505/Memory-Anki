"""The feed-card preview is a pure read: real map + unit, no session, no encounter."""

from __future__ import annotations

import json

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitState,
)
from memory_anki.modules.memory.api import reconcile_palace_units


def _doc() -> str:
    return json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "预览宫殿", "permanentSplitMark": True},
                "children": [{"data": {"uid": "node-a", "text": "节点 A"}, "children": []}],
            }
        },
        ensure_ascii=False,
    )


def _seed(session_factory) -> tuple[str, int]:
    with session_factory() as session:
        palace = Palace(title="预览宫殿", archived=False, editor_doc=_doc())
        session.add(palace)
        session.commit()
        reconcile_palace_units(session, palace.id)
        session.commit()
        unit = session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()
        return unit.id, palace.id


def test_preview_returns_map_and_unit_without_writing(session_factory, make_client):
    from memory_anki.modules.memory.presentation import router as review_router

    unit_id, palace_id = _seed(session_factory)
    with session_factory() as session:
        sessions_before = session.query(StudySession).count()
        encounters_before = session.query(ReviewUnitEncounter).count()

    client = make_client(review_router)
    response = client.get(f"/api/v1/review/units/{unit_id}/preview")

    assert response.status_code == 200
    item = response.json()["item"]
    assert item["palace_id"] == palace_id
    assert item["palace"]["editor_doc"]["root"]["data"]["uid"] == "root"
    assert [unit["id"] for unit in item["units"]] == [unit_id]
    assert item["units"][0]["encounter"] is None
    assert "node-a" in item["units"][0]["node_uids"]

    with session_factory() as session:
        assert session.query(StudySession).count() == sessions_before
        assert session.query(ReviewUnitEncounter).count() == encounters_before


def test_preview_of_unknown_unit_is_404(session_factory, make_client):
    from memory_anki.modules.memory.presentation import router as review_router

    client = make_client(review_router)
    assert client.get("/api/v1/review/units/missing/preview").status_code == 404
