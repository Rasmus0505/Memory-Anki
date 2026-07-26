"""Tests for temporary freestyle marks and FSRS unify."""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import FreestyleTemporaryMark, ReviewNodeState
from memory_anki.modules.memory.application.temporary_mark_unify import (
    unify_fsrs_progress_for_node_groups,
)
from memory_anki.modules.practice.application.temporary_marks import (
    get_palace_temporary_marks,
    list_active_temporary_roots,
    mark_temporary_roots_completed_on_settlement,
    replace_palace_temporary_marks,
)
from memory_anki.modules.practice.domain.branch_units import (
    derive_permanent_mark_levels,
    filter_outermost_roots,
    split_branch_units,
)
from memory_anki.modules.practice.domain.queue_builder import build_palace_units
from memory_anki.modules.practice.presentation import router as practice_router


def test_filter_outermost_roots_and_levels():
    nodes = {
        "root": {"uid": "root", "parent_uid": None, "children": ["a"], "text": "R"},
        "a": {"uid": "a", "parent_uid": "root", "children": ["b"], "text": "A"},
        "b": {"uid": "b", "parent_uid": "a", "children": [], "text": "B"},
    }
    assert filter_outermost_roots(nodes, ["a", "b"]) == ["a"]
    assert derive_permanent_mark_levels(nodes, ["a", "b"], root_uid="root") == {
        "a": 1,
        "b": 2,
    }


def _seed_palace(session):
    palace = Palace(
        title="Temp marks",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {
                            "data": {"uid": "north", "text": "北部"},
                            "children": [
                                {"data": {"uid": "n1", "text": "宗教"}, "children": []}
                            ],
                        },
                        {
                            "data": {"uid": "south", "text": "南部"},
                            "children": [
                                {"data": {"uid": "s1", "text": "庄园"}, "children": []}
                            ],
                        },
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.flush()
    past = utc_now_naive() - timedelta(days=2)
    for uid, stability in (("north", 2.0), ("n1", 10.0), ("south", 4.0), ("s1", 6.0)):
        session.add(
            ReviewNodeState(
                palace_id=palace.id,
                node_uid=uid,
                state=2,
                stability=stability,
                difficulty=5.0,
                due_at=past,
                raw_due_at=past,
                last_review_at=past - timedelta(days=3),
                schedule_source="manual",
                content_fingerprint="",
            )
        )
    session.commit()
    return palace


def test_unify_averages_and_writes_all(db_session):
    palace = _seed_palace(db_session)
    result = unify_fsrs_progress_for_node_groups(
        db_session,
        palace_id=palace.id,
        node_uids=["north", "n1", "south", "s1"],
        commit=True,
    )
    assert result["skipped"] is False
    assert result["source_count"] == 4
    assert abs(result["average"]["stability"] - 5.5) < 1e-6
    rows = {
        row.node_uid: row
        for row in db_session.query(ReviewNodeState).filter_by(palace_id=palace.id).all()
    }
    for uid in ("north", "n1", "south", "s1"):
        assert abs(float(rows[uid].stability) - 5.5) < 1e-6
        assert rows[uid].schedule_reason == "temporary_mark_unify"


def test_unify_skips_when_no_fsrs(db_session):
    palace = Palace(title="Empty", archived=False, editor_doc="{}")
    db_session.add(palace)
    db_session.commit()
    result = unify_fsrs_progress_for_node_groups(
        db_session,
        palace_id=palace.id,
        node_uids=["x", "y"],
        commit=True,
    )
    assert result["skipped"] is True
    assert result["reason"] == "no_existing_fsrs"


def test_replace_temporary_marks_and_queue_units(db_session):
    palace = _seed_palace(db_session)
    payload = replace_palace_temporary_marks(
        db_session,
        palace_id=palace.id,
        node_uids=["north", "south", "n1"],  # nested n1 kept (no outermost filter)
        unify_progress=True,
    )
    assert payload["active_root_uids"] == ["north", "south", "n1"]
    assert payload["unify"]["skipped"] is False

    roots = list_active_temporary_roots(db_session, palace_id=palace.id)
    assert roots[palace.id] == ["north", "south", "n1"]

    nodes = {
        "root": {"uid": "root", "parent_uid": None, "children": ["north", "south"], "text": "R"},
        "north": {"uid": "north", "parent_uid": "root", "children": ["n1"], "text": "N"},
        "n1": {"uid": "n1", "parent_uid": "north", "children": [], "text": "N1"},
        "south": {"uid": "south", "parent_uid": "root", "children": ["s1"], "text": "S"},
        "s1": {"uid": "s1", "parent_uid": "south", "children": [], "text": "S1"},
    }
    # Nested temp marks force-split: north has deeper mark n1 -> unit at n1 with north folded
    units = build_palace_units(
        palace_id=palace.id,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        within_palace_order="tree",
        seed=1,
        temporary_root_uids=["north", "south", "n1"],
    )
    assert {u.branch_uid for u in units} == {"north", "n1", "south"}  # water-pour: north residual + n1 + south
    assert all(u.selection_reason.startswith("temporary_mark") for u in units)
    by = {u.branch_uid: set(u.ratable_node_uids) for u in units}
    assert by["north"] == {"north"}
    assert by["n1"] == {"n1"}
    assert by["south"] == {"south", "s1"}

    completed = mark_temporary_roots_completed_on_settlement(
        db_session,
        palace_id=palace.id,
        branch_or_scope_uids=["n1", "north"],
        had_good_or_easy=True,
    )
    assert set(completed) == {"north", "n1"}
    marks = get_palace_temporary_marks(db_session, palace.id)
    assert "north" not in marks["active_root_uids"]
    assert "n1" not in marks["active_root_uids"]
    assert "south" in marks["active_root_uids"]


def test_nested_temporary_marks_all_saved_and_queue_nest_splits(db_session):
    """All nested temp marks are persisted; queue units nest-split like permanent."""
    palace = _seed_palace(db_session)
    payload = replace_palace_temporary_marks(
        db_session,
        palace_id=palace.id,
        node_uids=["north", "n1"],
        unify_progress=False,
    )
    assert payload["active_root_uids"] == ["north", "n1"]
    marks = get_palace_temporary_marks(db_session, palace.id)
    assert [m["node_uid"] for m in marks["marks"]] == ["north", "n1"]

    nodes = {
        "root": {"uid": "root", "parent_uid": None, "children": ["north", "south"], "text": "R"},
        "north": {"uid": "north", "parent_uid": "root", "children": ["n1"], "text": "N"},
        "n1": {"uid": "n1", "parent_uid": "north", "children": [], "text": "N1"},
        "south": {"uid": "south", "parent_uid": "root", "children": ["s1"], "text": "S"},
        "s1": {"uid": "s1", "parent_uid": "south", "children": [], "text": "S1"},
    }
    units = split_branch_units(
        palace_id=palace.id,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=["north", "n1"],
    )
    assert {u.branch_uid for u in units} == {"north", "n1", "south"}  # water-pour
    by = {u.branch_uid: set(u.ratable_node_uids) for u in units}
    assert by["north"] == {"north"}
    assert by["n1"] == {"n1"}
    assert by["south"] == {"south", "s1"}
    assert all(u.selection_reason.startswith("temporary_mark") for u in units if u.branch_uid in {"north", "n1"})


def test_temporary_marks_api(make_client, db_session, session_factory):
    palace = _seed_palace(db_session)
    client = make_client(practice_router)
    response = client.put(
        f"/api/v1/freestyle/temporary-marks/{palace.id}",
        json={"node_uids": ["north", "south"], "unify_progress": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["active_root_uids"] == ["north", "south"]

    listed = client.get(f"/api/v1/freestyle/temporary-marks/{palace.id}")
    assert listed.status_code == 200
    assert listed.json()["active_root_uids"] == ["north", "south"]

    cleared = client.delete(f"/api/v1/freestyle/temporary-marks/{palace.id}")
    assert cleared.status_code == 200
    assert client.get(f"/api/v1/freestyle/temporary-marks/{palace.id}").json()["active_root_uids"] == []


def test_permanent_mark_field_forces_split():
    nodes = {
        "root": {"uid": "root", "parent_uid": None, "children": ["a", "b"], "text": "R"},
        "a": {
            "uid": "a",
            "parent_uid": "root",
            "children": ["a1", "a2"],
            "text": "A",
            "permanent_split_mark": True,
        },
        "a1": {
            "uid": "a1",
            "parent_uid": "a",
            "children": ["a1x"],
            "text": "A1",
            "permanent_split_mark": True,
        },
        "a1x": {"uid": "a1x", "parent_uid": "a1", "children": [], "text": "X"},
        "a2": {
            "uid": "a2",
            "parent_uid": "a",
            "children": ["a2x"],
            "text": "A2",
            "permanent_split_mark": True,
        },
        "a2x": {"uid": "a2x", "parent_uid": "a2", "children": [], "text": "Y"},
        "b": {"uid": "b", "parent_uid": "root", "children": ["b1"], "text": "B"},
        "b1": {"uid": "b1", "parent_uid": "b", "children": [], "text": "B1"},
    }
    units = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        permanent_mark_uids=["a", "a1", "a2"],
    )
    assert {u.branch_uid for u in units} == {"a", "a1", "a2", "b"}  # water-pour: a residual + a1 + a2 + b
    by = {u.branch_uid: set(u.ratable_node_uids) for u in units}
    assert by["a"] == {"a"}
    assert by["a1"] == {"a1", "a1x"}
    assert by["a2"] == {"a2", "a2x"}
    assert by["b"] == {"b", "b1"}
