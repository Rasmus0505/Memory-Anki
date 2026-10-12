from datetime import date, datetime

from memory_anki.modules.practice.domain.queue_builder import sort_due_phase_units
from memory_anki.modules.practice.domain.review_units import ReviewUnitCandidate


def _unit(unit_id: str, due: date | None, passed: datetime | None) -> ReviewUnitCandidate:
    return ReviewUnitCandidate(
        palace_id=1,
        anchor_uid=unit_id,
        context_path=(),
        node_uids=(unit_id,),
        unit_id=unit_id,
        revision=1,
        due_date=due,
        last_passed_at=passed,
    )


def test_most_overdue_first_then_least_recently_passed_then_never_passed():
    units = [
        _unit("recent", date(2026, 10, 1), datetime(2026, 9, 30)),
        _unit("never", date(2026, 10, 1), None),
        _unit("old", date(2026, 10, 1), datetime(2026, 1, 1)),
        _unit("most-overdue", date(2026, 9, 1), datetime(2026, 8, 1)),
    ]

    ordered = sort_due_phase_units(units, {})

    assert [unit.unit_id for unit in ordered] == ["most-overdue", "never", "old", "recent"]


def test_units_without_dates_keep_a_stable_order():
    units = [_unit("b", None, None), _unit("a", None, None)]

    assert [unit.unit_id for unit in sort_due_phase_units(units, {})] == ["a", "b"]
