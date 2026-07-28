from datetime import date

from memory_anki.modules.memory.application.unit_scheduler import (
    INTERVAL_DAYS,
    rate_unit,
    stage_from_legacy_interval_days,
)
from memory_anki.modules.mindmap_document.split_units import split_scheduling_units


def _tree():
    return {
        "root": {"text": "宫殿", "parent_uid": None, "children": ["a", "b"]},
        "a": {"text": "A", "parent_uid": "root", "children": ["a1", "a2"]},
        "a1": {"text": "A1", "parent_uid": "a", "children": []},
        "a2": {"text": "A2", "parent_uid": "a", "children": ["deep"]},
        "deep": {"text": "Deep", "parent_uid": "a2", "children": []},
        "b": {"text": "B", "parent_uid": "root", "children": ["b1"]},
        "b1": {"text": "B1", "parent_uid": "b", "children": []},
    }


def test_no_permanent_mark_means_no_review_units():
    assert split_scheduling_units(nodes=_tree(), root_uid="root", permanent_mark_uids=set()) == []


def test_child_marks_isolate_regions_and_leave_one_residual_unit():
    units = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"a", "deep"}
    )
    assert [(unit.unit_root_uid, unit.node_uids) for unit in units] == [
        ("a", ("a", "a1", "a2")),
        ("deep", ("deep",)),
        ("root", ("b", "b1")),
    ]
    memberships = [uid for unit in units for uid in unit.node_uids]
    assert sorted(memberships) == sorted(_tree().keys() - {"root"})
    assert len(memberships) == len(set(memberships))


def test_root_mark_represents_whole_palace_until_deeper_mark_cuts_it():
    whole = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"root"}
    )
    assert len(whole) == 1
    assert whole[0].node_uids == ("a", "a1", "a2", "deep", "b", "b1")

    split = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"root", "deep"}
    )
    assert [(unit.unit_root_uid, unit.node_uids) for unit in split] == [
        ("root", ("a", "a1", "a2", "b", "b1")),
        ("deep", ("deep",)),
    ]


def test_fixed_schedule_first_pass_failure_penalty_and_caps():
    today = date(2026, 7, 27)
    first_hard = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=2,
        had_failure_in_encounter=False,
        today=today,
    )
    assert (first_hard.stage_index, first_hard.due_date, first_hard.passed) == (0, today, False)

    remembered_after_hard = rate_unit(
        stage_index=first_hard.stage_index,
        has_passed=False,
        rating=3,
        had_failure_in_encounter=True,
        today=today,
    )
    assert remembered_after_hard.stage_index == 0
    assert remembered_after_hard.due_date == date(2026, 7, 28)

    easy_after_failure = rate_unit(
        stage_index=3,
        has_passed=True,
        rating=4,
        had_failure_in_encounter=True,
        today=today,
    )
    assert easy_after_failure.stage_index == 4
    assert easy_after_failure.due_date == date(2026, 8, 26)

    capped = rate_unit(
        stage_index=len(INTERVAL_DAYS) - 1,
        has_passed=True,
        rating=4,
        had_failure_in_encounter=False,
        today=today,
    )
    assert capped.stage_index == len(INTERVAL_DAYS) - 1
    assert capped.due_date == date(2027, 7, 27)


def test_legacy_intervals_map_down_to_fixed_ladder():
    assert stage_from_legacy_interval_days(0.2) == 0
    assert stage_from_legacy_interval_days(6.9) == 1
    assert stage_from_legacy_interval_days(7) == 2
    assert stage_from_legacy_interval_days(999) == len(INTERVAL_DAYS) - 1
