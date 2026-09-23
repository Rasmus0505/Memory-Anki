from datetime import date

from memory_anki.modules.memory.application.unit_scheduler import (
    INTERVAL_DAYS,
    rate_unit,
    stage_from_legacy_interval_days,
)
from memory_anki.modules.mindmap_document.split_units import (
    UNIT_KIND_COHORT,
    UNIT_KIND_MARK,
    UNIT_KIND_PALACE,
    UNIT_KIND_RESIDUAL,
    split_scheduling_units,
)


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


def _brief(units):
    return [(unit.kind, unit.unit_root_uid, unit.node_uids) for unit in units]


def _isolation_memberships(units):
    return [
        uid
        for unit in units
        if unit.kind != UNIT_KIND_COHORT
        for uid in unit.node_uids
    ]


def test_child_marks_isolate_regions_and_leave_one_residual_unit():
    units = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"a", "deep"}
    )
    assert _brief(units) == [
        (UNIT_KIND_COHORT, "root", ("a",)),
        (UNIT_KIND_MARK, "a", ("a", "a1", "a2")),
        (UNIT_KIND_MARK, "deep", ("deep",)),
        (UNIT_KIND_RESIDUAL, "root", ("b", "b1")),
    ]
    memberships = _isolation_memberships(units)
    assert sorted(memberships) == sorted(_tree().keys() - {"root"})
    assert len(memberships) == len(set(memberships))


def test_root_mark_represents_whole_palace_until_deeper_mark_cuts_it():
    whole = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"root"}
    )
    assert len(whole) == 1
    assert whole[0].kind == UNIT_KIND_PALACE
    assert whole[0].node_uids == ("a", "a1", "a2", "deep", "b", "b1")

    split = split_scheduling_units(
        nodes=_tree(), root_uid="root", permanent_mark_uids={"root", "deep"}
    )
    assert _brief(split) == [
        (UNIT_KIND_PALACE, "root", ("a", "a1", "a2", "b", "b1")),
        (UNIT_KIND_MARK, "deep", ("deep",)),
    ]


def _palace(*branches: tuple[str, list]) -> dict:
    """Build a palace whose root is ``A``.

    A branch is ``(uid, children)`` and a child is either a uid string or another
    ``(uid, children)`` pair. A uid ending in ``*`` is permanently marked; the
    star is not part of the stored uid.
    """
    nodes: dict[str, dict] = {
        "A": {"text": "A", "parent_uid": None, "children": []},
    }

    def add(parent: str, child) -> None:
        if isinstance(child, str):
            uid, kids = child, []
        else:
            uid, kids = child
        marked = uid.endswith("*")
        uid = uid[:-1] if marked else uid
        nodes[uid] = {
            "text": uid,
            "parent_uid": parent,
            "children": [],
            "permanent_split_mark": marked,
        }
        nodes[parent]["children"].append(uid)
        for kid in kids:
            add(uid, kid)

    for branch in branches:
        add("A", branch)
    return nodes


def _marks(nodes: dict) -> set[str]:
    return {
        uid
        for uid, node in nodes.items()
        if node.get("permanent_split_mark") is True
    }


def test_same_parent_marks_add_a_cohort_before_each_branch():
    nodes = _palace(("B1*", ["C1"]), ("B2*", ["C2"]))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [
        (UNIT_KIND_COHORT, "A", ("B1", "B2")),
        (UNIT_KIND_MARK, "B1", ("B1", "C1")),
        (UNIT_KIND_MARK, "B2", ("B2", "C2")),
    ]


def test_leaf_siblings_still_get_a_cohort_besides_their_own_cards():
    nodes = _palace(("B1*", []), ("B2*", []))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [
        (UNIT_KIND_COHORT, "A", ("B1", "B2")),
        (UNIT_KIND_MARK, "B1", ("B1",)),
        (UNIT_KIND_MARK, "B2", ("B2",)),
    ]


def test_single_leaf_mark_is_not_duplicated_as_a_cohort():
    nodes = _palace(("B1*", []))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [(UNIT_KIND_MARK, "B1", ("B1",))]


def test_single_mark_with_descendants_gets_its_own_cohort():
    nodes = _palace(("B1*", ["C1"]))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [
        (UNIT_KIND_COHORT, "A", ("B1",)),
        (UNIT_KIND_MARK, "B1", ("B1", "C1")),
    ]


def test_deeper_leaf_marks_cohort_omits_the_duplicate_parent_card():
    nodes = _palace(("B1*", [("C1*", []), ("C2*", [])]))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [
        (UNIT_KIND_MARK, "B1", ("B1",)),
        (UNIT_KIND_COHORT, "B1", ("C1", "C2")),
        (UNIT_KIND_MARK, "C1", ("C1",)),
        (UNIT_KIND_MARK, "C2", ("C2",)),
    ]


def test_same_depth_marks_under_different_parents_stay_apart():
    nodes = _palace(("B1*", ["C1"]), ("B2*", ["C2"]), ("E", [("F*", [])]))
    units = split_scheduling_units(
        nodes=nodes, root_uid="A", permanent_mark_uids=_marks(nodes)
    )
    assert _brief(units) == [
        (UNIT_KIND_COHORT, "A", ("B1", "B2")),
        (UNIT_KIND_MARK, "B1", ("B1", "C1")),
        (UNIT_KIND_MARK, "B2", ("B2", "C2")),
        (UNIT_KIND_MARK, "F", ("F",)),
        (UNIT_KIND_RESIDUAL, "A", ("E",)),
    ]
    cohort_members = [
        unit.node_uids for unit in units if unit.kind == UNIT_KIND_COHORT
    ]
    assert cohort_members == [("B1", "B2")]


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
    assert remembered_after_hard.stage_index == 1
    assert remembered_after_hard.due_date == date(2026, 7, 28)

    first_remembered = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=3,
        had_failure_in_encounter=False,
        today=today,
    )
    assert first_remembered.stage_index == 1
    assert first_remembered.due_date == date(2026, 7, 28)

    easy_after_failure = rate_unit(
        stage_index=3,
        has_passed=True,
        rating=4,
        had_failure_in_encounter=True,
        today=today,
    )
    assert easy_after_failure.stage_index == 4
    assert easy_after_failure.due_date == date(2026, 8, 10)

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
    assert stage_from_legacy_interval_days(6.9) == 2
    assert stage_from_legacy_interval_days(7) == 3
    assert stage_from_legacy_interval_days(999) == len(INTERVAL_DAYS) - 1
