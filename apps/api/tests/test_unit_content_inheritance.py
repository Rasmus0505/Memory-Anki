"""Content edits and new branches carry entry-time schedule evidence, never penalties."""

import json
from datetime import date, datetime, timedelta

import pytest

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import reconcile_palace_units


def node(uid, *children, mark=False):
    return {"data": {"uid": uid, "text": uid, "permanentSplitMark": mark},
            "children": list(children)}


def document(*children, mark=True):
    root = node("root", *children, mark=mark)
    root["data"]["memoryAnkiRootKind"] = "palace"
    return json.dumps({"root": root})


def rows(session, palace):
    return {(row.anchor_uid, row.unit_kind): row for row in
            session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True)}


def seed(session, doc):
    palace = Palace(title="Inheritance", archived=False, editor_doc=doc)
    session.add(palace)
    session.flush()
    reconcile_palace_units(session, palace.id)
    session.flush()
    return palace


def schedule(row, stage, days):
    row.stage_index = stage
    row.due_date = local_day() + timedelta(days=days)
    row.has_passed = True
    row.last_passed_at = datetime(2026, 1, 2)


def assert_schedule(row, stage, days):
    assert (row.stage_index, row.due_date, row.has_passed) == (
        stage, local_day() + timedelta(days=days), True,
    )


def test_new_mark_on_existing_content_inherits_original_region(db_session):
    palace = seed(db_session, document(node("a", node("leaf")), node("b")))
    original = rows(db_session, palace)[("root", "palace")]
    schedule(original, 6, 60)
    original_id = original.id
    palace.editor_doc = document(node("a", node("leaf"), mark=True), node("b"))
    reconcile_palace_units(db_session, palace.id)
    active = rows(db_session, palace)
    assert active[("root", "palace")].id == original_id
    for row in active.values():
        assert_schedule(row, 6, 60)
    assert active[("a", "mark")].last_passed_at == datetime(2026, 1, 2)


@pytest.mark.parametrize("nested", [False, True])
def test_new_marked_node_walks_to_nearest_existing_branch(db_session, nested):
    palace = seed(db_session, document(node("a", node("old"), mark=True), node("b")))
    active = rows(db_session, palace)
    for row in active.values():
        schedule(row, 1, 1)
    schedule(active[("a", "mark")], 6, 60)
    new = node("new", mark=True)
    if nested:
        new = node("new-parent", new)
    palace.editor_doc = document(node("a", node("old"), new, mark=True), node("b"))
    reconcile_palace_units(db_session, palace.id)
    active = rows(db_session, palace)
    assert_schedule(active[("new", "mark")], 6, 60)
    assert_schedule(active[("a", "mark")], 6, 60)
    # A low sibling score is not this branch's schedule.
    assert_schedule(active[("root", "palace")], 1, 1)


def test_new_root_branch_inherits_root_isolation_not_siblings(db_session):
    palace = seed(db_session, document(node("a", mark=True), node("b")))
    active = rows(db_session, palace)
    schedule(active[("root", "palace")], 5, 30)
    schedule(active[("a", "mark")], 1, 1)
    palace.editor_doc = document(node("a", mark=True), node("b"), node("new", mark=True))
    reconcile_palace_units(db_session, palace.id)
    assert_schedule(rows(db_session, palace)[("new", "mark")], 5, 30)


def test_merge_uses_independent_minima_from_frozen_original_sources(db_session):
    palace = seed(db_session, document(node("a", node("leaf"), mark=True), node("b")))
    active = rows(db_session, palace)
    for row in active.values():
        schedule(row, 5, 3)
    schedule(active[("a", "mark")], 2, 30)
    original_root = active[("root", "palace")].id
    # Root absorbs a; a new leaf split must inherit a's OLD state, not root's
    # freshly merged schedule (root is reconciled before the split).
    palace.editor_doc = document(node("a", node("leaf", mark=True)), node("b"))
    reconcile_palace_units(db_session, palace.id)
    active = rows(db_session, palace)
    assert active[("root", "palace")].id == original_root
    assert_schedule(active[("root", "palace")], 2, 3)
    assert_schedule(active[("leaf", "mark")], 2, 30)


def test_inactive_uncovered_region_is_not_lost_when_merged_with_live_region(db_session):
    palace = seed(db_session, document(node("a", mark=True), node("b", mark=True)))
    active = rows(db_session, palace)
    for row in active.values():
        schedule(row, 6, 60)
    inactive = active[("a", "mark")]
    schedule(inactive, 2, 3)
    inactive.active = False
    palace.editor_doc = document(node("a"), node("b"))
    reconcile_palace_units(db_session, palace.id)
    assert_schedule(rows(db_session, palace)[("root", "palace")], 2, 3)


def test_new_content_without_ancestor_evidence_starts_initial_learning(db_session):
    palace = seed(db_session, document(node("old", mark=True), mark=False))
    schedule(rows(db_session, palace)[("old", "mark")], 6, 60)
    palace.editor_doc = document(node("old", mark=True), node("new", mark=True), mark=False)
    reconcile_palace_units(db_session, palace.id)
    new = rows(db_session, palace)[("new", "mark")]
    assert (new.stage_index, new.due_date, new.has_passed) == (0, local_day(), False)


def test_content_edit_preserves_identity_schedule_and_last_pass(db_session):
    palace = seed(db_session, document(node("a")))
    original = rows(db_session, palace)[("root", "palace")]
    schedule(original, 7, 120)
    old_id, revision = original.id, original.revision
    doc = json.loads(palace.editor_doc)
    doc["root"]["children"][0]["data"]["text"] = "Completely rewritten content"
    palace.editor_doc = json.dumps(doc)
    result = reconcile_palace_units(db_session, palace.id)
    changed = rows(db_session, palace)[("root", "palace")]
    assert changed.id == old_id
    assert changed.revision == revision + 1
    assert changed.last_passed_at == datetime(2026, 1, 2)
    assert_schedule(changed, 7, 120)
    assert [entry["action"] for entry in result["changes"]] == ["content_updated"]
    assert result["undo_token"] is None
    assert reconcile_palace_units(db_session, palace.id)["changed"] is False


def test_invalid_later_source_does_not_partially_apply_earlier_content_edit(db_session):
    palace = seed(db_session, document(node("a", mark=True), node("b")))
    active = rows(db_session, palace)
    root = active[("root", "palace")]
    bad = active[("a", "mark")]
    schedule(root, 5, 30)
    bad.due_date = date(2099, 1, 1)
    db_session.commit()
    original_hash, original_revision = root.content_hash, root.revision
    doc = json.loads(palace.editor_doc)
    doc["root"]["children"][1]["data"]["text"] = "Changed root member"
    palace.editor_doc = json.dumps(doc)
    db_session.commit()
    with pytest.raises(ValueError, match="一年"):
        reconcile_palace_units(db_session, palace.id)
    # Even a caller that catches the error then commits cannot persist half a plan.
    db_session.commit()
    db_session.expire_all()
    root = rows(db_session, palace)[("root", "palace")]
    assert (root.content_hash, root.revision) == (original_hash, original_revision)
    assert_schedule(root, 5, 30)
    assert rows(db_session, palace)[("a", "mark")].due_date == date(2099, 1, 1)


def test_corrupt_membership_is_rejected_instead_of_resetting_progress(db_session):
    palace = seed(db_session, document(node("a")))
    original = rows(db_session, palace)[("root", "palace")]
    schedule(original, 6, 60)
    original.node_uids_json = "corrupt"
    with pytest.raises(ValueError):
        reconcile_palace_units(db_session, palace.id)
    assert_schedule(original, 6, 60)
