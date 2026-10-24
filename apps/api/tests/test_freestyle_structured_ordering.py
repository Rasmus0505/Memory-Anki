from datetime import date

from memory_anki.modules.practice.domain.queue_builder import (
    assemble_queue,
    sort_structured_units,
)
from memory_anki.modules.practice.domain.review_units import ReviewUnitCandidate


def _unit(
    unit_id: str,
    topology_order: int,
    *,
    due: date | None = None,
    passed: bool = False,
    palace_id: int = 1,
) -> ReviewUnitCandidate:
    return ReviewUnitCandidate(
        palace_id=palace_id,
        anchor_uid=unit_id,
        context_path=(),
        node_uids=(unit_id,),
        unit_id=unit_id,
        revision=1,
        due_date=due,
        has_passed=passed,
        topology_order=topology_order,
    )


def _assemble(units: list[ReviewUnitCandidate], *, unit_order: str = "structured") -> list[str]:
    result = assemble_queue(
        config={
            "content": {"mindmap_branch": True, "quiz_question": False},
            "mix_mode": "mindmap_only",
            "palace_order": "finish_palace_then_next",
            "unit_order": unit_order,
            "seed": 17,
            "new_placement": "new_first",
        },
        palace_meta={1: {"title": "学记"}},
        units_by_palace={1: units},
        due_by_palace={1: {unit.anchor_uid for unit in units}},
        quizzes=[],
    )
    return [card["unit_id"] for card in result.cards]


def test_structured_order_follows_the_mind_map_not_the_due_date_or_unit_id():
    # All six units are new and due today: due date and pass history cannot
    # separate them, so only the knowledge structure may decide. Unit ids are
    # chosen so a lexical sort would scramble the map order.
    units = [
        _unit("zz-first", 0),
        _unit("yy-second", 1),
        _unit("xx-third", 2),
        _unit("ww-fourth", 3),
        _unit("vv-fifth", 4),
    ]

    assert _assemble(units) == [
        "zz-first",
        "yy-second",
        "xx-third",
        "ww-fourth",
        "vv-fifth",
    ]


def test_structured_order_does_not_let_an_overdue_unit_jump_the_map():
    # Same pass group, different overdue dates: only structure may decide.
    units = [
        _unit("first", 0, due=date(2026, 10, 23), passed=True),
        _unit("second", 1, due=date(2026, 9, 1), passed=True),
        _unit("third", 2, due=date(2026, 10, 23), passed=True),
    ]

    assert _assemble(units) == ["first", "second", "third"]


def test_structured_order_still_puts_new_units_before_reviews():
    units = [
        _unit("review-first", 0, passed=True),
        _unit("new-second", 1),
        _unit("review-third", 2, passed=True),
    ]

    assert _assemble(units) == ["new-second", "review-first", "review-third"]


def test_random_unit_order_breaks_the_struct_sequence():
    units = [_unit(f"unit-{index}", index) for index in range(8)]

    assert _assemble(units, unit_order="random") != [unit.unit_id for unit in units]


def test_sort_structured_units_is_stable_for_equal_topology():
    units = [_unit("b", 0), _unit("a", 0)]

    assert [unit.unit_id for unit in sort_structured_units(units)] == ["b", "a"]
