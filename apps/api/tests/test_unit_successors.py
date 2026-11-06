"""A retired review unit follows its content into the live unit that owns it."""

from __future__ import annotations

import json

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import resolve_unit_successors


def _state(
    session,
    palace_id: int,
    unit_id: str,
    *,
    anchor_uid: str,
    node_uids: list[str],
    active: bool,
    unit_kind: str = "mark",
) -> ReviewUnitState:
    row = ReviewUnitState(
        id=unit_id,
        palace_id=palace_id,
        anchor_uid=anchor_uid,
        unit_kind=unit_kind,
        node_uids_json=json.dumps(node_uids),
        membership_hash=f"membership-{unit_id}",
        content_hash=f"content-{unit_id}",
        revision=1,
        stage_index=0,
        has_passed=False,
        due_date=local_day(),
        active=active,
    )
    session.add(row)
    return row


def _palace(session, title: str = "P") -> Palace:
    palace = Palace(title=title, archived=False, editor_doc="{}")
    session.add(palace)
    session.flush()
    return palace


def test_unmarked_child_follows_its_nodes_into_the_residual_unit(db_session):
    palace = _palace(db_session)
    _state(db_session, palace.id, "b1", anchor_uid="b1", node_uids=["b1"], active=False)
    _state(
        db_session, palace.id, "residual",
        anchor_uid="palace-root", node_uids=["b1", "b2"], active=True,
        unit_kind="residual",
    )
    db_session.flush()

    assert resolve_unit_successors(db_session, ["b1"]) == {"b1": "residual"}


def test_root_palace_mark_flips_to_the_root_residual(db_session):
    palace = _palace(db_session)
    _state(
        db_session, palace.id, "whole", anchor_uid="palace-root",
        node_uids=["a", "b"], active=False, unit_kind="palace",
    )
    _state(
        db_session, palace.id, "residual",
        anchor_uid="palace-root", node_uids=["a", "b"], active=True,
        unit_kind="residual",
    )
    db_session.flush()

    assert resolve_unit_successors(db_session, ["whole"]) == {"whole": "residual"}


def test_a_split_is_not_a_continuation(db_session):
    palace = _palace(db_session)
    _state(
        db_session, palace.id, "old", anchor_uid="gone",
        node_uids=["x", "y"], active=False,
    )
    _state(db_session, palace.id, "left", anchor_uid="x", node_uids=["x"], active=True)
    _state(db_session, palace.id, "right", anchor_uid="y", node_uids=["y"], active=True)
    db_session.flush()

    assert resolve_unit_successors(db_session, ["old"]) == {}


def test_deleted_anchor_falls_back_to_dominant_node_overlap(db_session):
    palace = _palace(db_session)
    _state(
        db_session, palace.id, "old", anchor_uid="deleted-anchor",
        node_uids=["x", "y"], active=False,
    )
    _state(
        db_session, palace.id, "residual",
        anchor_uid="palace-root", node_uids=["x", "y", "z"], active=True,
    )
    db_session.flush()

    assert resolve_unit_successors(db_session, ["old"]) == {"old": "residual"}


def test_unrelated_content_has_no_successor(db_session):
    palace = _palace(db_session)
    _state(db_session, palace.id, "old", anchor_uid="old", node_uids=["x"], active=False)
    _state(db_session, palace.id, "other", anchor_uid="other", node_uids=["y"], active=True)
    db_session.flush()

    assert resolve_unit_successors(db_session, ["old"]) == {}


def test_permanently_removed_unit_is_never_revived_by_a_successor(db_session):
    palace = _palace(db_session)
    retired = _state(
        db_session, palace.id, "removed", anchor_uid="removed",
        node_uids=["x"], active=False,
    )
    retired.permanently_removed = True
    _state(
        db_session, palace.id, "residual",
        anchor_uid="palace-root", node_uids=["x"], active=True,
        unit_kind="residual",
    )
    db_session.flush()

    assert resolve_unit_successors(db_session, ["removed"]) == {}


def test_live_unit_is_not_reported_as_its_own_successor(db_session):
    palace = _palace(db_session)
    _state(db_session, palace.id, "live", anchor_uid="live", node_uids=["x"], active=True)
    db_session.flush()

    assert resolve_unit_successors(db_session, ["live"]) == {}
