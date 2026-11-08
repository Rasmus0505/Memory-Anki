"""Content edits and new branches carry entry-time schedule evidence, never penalties."""

import json
from datetime import date, datetime, time, timedelta

import pytest

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import reconcile_palace_units
from memory_anki.modules.memory.application.unit_schedule_projection import (
    unit_interval_days,
)


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


def _leave_unstudied(row):
    """A marked region that was never rated: no stage, pass or FSRS checkpoint."""
    row.stage_index = 0
    row.due_date = local_day()
    row.has_passed = False
    row.last_passed_at = None
    row.fsrs_last_review = None
    row.early_step = None


def _whole_palace_row(session, palace):
    return (
        session.query(ReviewUnitState)
        .filter_by(palace_id=palace.id, anchor_uid="root", unit_kind="palace", active=True)
        .one()
    )


def test_unstudied_region_does_not_reset_a_whole_palace_merge(db_session):
    """One never-studied remainder must not drag studied segments back to 首学.

    Reported flow: remove every permanent mark, then mark the palace root as
    整宫. The merged unit used to inherit stage 0 from the untouched residue,
    showing the whole palace as first learning again.
    """
    palace = seed(db_session, document(node("a", mark=True), node("b", mark=True)))
    active = rows(db_session, palace)
    today = local_day()
    schedule(active[("a", "mark")], 5, 30)
    _store_checkpoint(
        active[("a", "mark")],
        stability=14.0,
        reviewed_on=today - timedelta(days=14),
        due=today + timedelta(days=30),
    )
    _leave_unstudied(active[("b", "mark")])
    db_session.flush()

    # Single edit pass: both child marks removed, root marked.
    palace.editor_doc = document(node("a"), node("b"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    root = _whole_palace_row(db_session, palace)
    assert root.stage_index == 5, "the studied segment's level must survive the merge"
    assert root.has_passed is True
    # The untouched region still makes the merged unit due, so its content is
    # reviewed instead of being silently skipped.
    assert root.due_date == local_day()


def test_merge_never_books_a_unit_before_its_last_review(db_session):
    """A stale leftover due date must not become the merged unit's booking.

    Reported flow: a whole-palace mark inherited the due date of a never-studied
    fragment (booked weeks before the memory checkpoint was last reviewed). The
    gap then read as zero, the panel showed 首学, and the next 记得 jumped far out
    instead of continuing from the interval the learner had earned.
    """
    palace = seed(db_session, document(node("a", mark=True), node("b", mark=True)))
    active = rows(db_session, palace)
    today = local_day()
    studied = active[("a", "mark")]
    schedule(studied, 4, 30)
    _store_checkpoint(
        studied,
        stability=20.0,
        reviewed_on=today - timedelta(days=20),
        due=today + timedelta(days=30),
    )
    leftover = active[("b", "mark")]
    _leave_unstudied(leftover)
    leftover.due_date = today - timedelta(days=40)
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    root = _whole_palace_row(db_session, palace)
    assert root.due_date == today, "new content still comes due now, never 'before' the review"
    assert root.fsrs_last_review == datetime.combine(today - timedelta(days=20), time(4))
    assert unit_interval_days(root) == 20
    assert root.fsrs_due_at == datetime.combine(today, time(4))


def test_unstudied_region_does_not_reset_a_two_step_whole_palace_merge(db_session):
    palace = seed(db_session, document(node("a", mark=True), node("b", mark=True)))
    active = rows(db_session, palace)
    schedule(active[("a", "mark")], 4, 20)
    _leave_unstudied(active[("b", "mark")])
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"))
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    root = _whole_palace_row(db_session, palace)
    assert (root.stage_index, root.has_passed) == (4, True)


def test_merge_of_only_unstudied_units_still_starts_at_first_learning(db_session):
    palace = seed(db_session, document(node("a", mark=True), node("b", mark=True)))
    for row in rows(db_session, palace).values():
        _leave_unstudied(row)
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    root = _whole_palace_row(db_session, palace)
    assert (root.stage_index, root.has_passed) == (0, False)
    assert root.fsrs_stability is None
    assert root.fsrs_last_review is None


def _store_checkpoint(row, *, stability, reviewed_on, due):
    row.fsrs_stability = stability
    row.fsrs_difficulty = 5.0
    row.fsrs_state = 2
    row.fsrs_step = None
    row.fsrs_due_at = datetime.combine(due, time(4))
    row.fsrs_last_review = datetime.combine(reviewed_on, time(4))
    row.fsrs_scheduler_version = "test"


def test_merge_carries_the_weakest_memory_checkpoint(db_session):
    """Four marked branches consolidated into one whole-palace unit.

    Reported flow: three branches had been pulled forward to today (stage bucket
    0, still passed, FSRS checkpoint intact) while one was still booked 40 days
    out. The merge used to inherit only the buckets, land on 0 and read as
    first learning again.
    """
    palace = seed(db_session, document(
        node("a", mark=True), node("b", mark=True),
        node("c", mark=True), node("d", mark=True),
    ))
    today = local_day()
    active = rows(db_session, palace)
    for uid, stability, days_ago in (("a", 17.0, 17), ("b", 14.0, 14), ("c", 21.0, 21)):
        row = active[(uid, "mark")]
        row.stage_index = 0
        row.due_date = today
        row.has_passed = True
        row.last_passed_at = datetime.combine(today - timedelta(days=days_ago), time(4))
        row.early_step = 1
        _store_checkpoint(
            row,
            stability=stability,
            reviewed_on=today - timedelta(days=days_ago),
            due=today,
        )
    d = active[("d", "mark")]
    schedule(d, 7, 40)
    _store_checkpoint(
        d,
        stability=45.0,
        reviewed_on=today - timedelta(days=40),
        due=today + timedelta(days=40),
    )
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"), node("c"), node("d"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()

    root = _whole_palace_row(db_session, palace)
    assert root.has_passed is True
    # The weakest earned checkpoint (b: 14 days) travels with the merge.
    assert root.fsrs_stability == 14.0
    assert root.fsrs_last_review == datetime.combine(today - timedelta(days=14), time(4))
    assert unit_interval_days(root) == 14


def test_reconcile_heals_a_merge_that_lost_its_memory_checkpoint(db_session):
    """A merge made before checkpoints were carried heals on the next reconcile."""
    palace = seed(db_session, document(node("a", mark=True), node("b"), mark=True))
    today = local_day()
    a = rows(db_session, palace)[("a", "mark")]
    schedule(a, 5, 30)
    _store_checkpoint(
        a,
        stability=30.0,
        reviewed_on=today - timedelta(days=30),
        due=today + timedelta(days=30),
    )
    db_session.flush()

    palace.editor_doc = document(node("a"), node("b"), mark=True)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()
    root = _whole_palace_row(db_session, palace)
    assert root.fsrs_stability == 30.0

    # Simulate a row that was merged while only the legacy bucket was inherited.
    for field in (
        "fsrs_stability", "fsrs_difficulty", "fsrs_state", "fsrs_step",
        "fsrs_due_at", "fsrs_last_review", "fsrs_scheduler_version",
    ):
        setattr(root, field, None)
    db_session.flush()
    reconcile_palace_units(db_session, palace.id)
    db_session.flush()
    assert root.fsrs_stability == 30.0
    assert unit_interval_days(root) == 30
