from datetime import date, timedelta

from memory_anki.modules.quiz.application.question_scheduler import (
    legacy_unpassed_due_counts_as_marked,
    question_is_due,
    schedule_due_kind,
)


def test_legacy_forget_and_hard_schedules_count_as_marked() -> None:
    today = date(2026, 9, 17)
    assert legacy_unpassed_due_counts_as_marked(schedule_passed=False, schedule_due_on=today)
    assert legacy_unpassed_due_counts_as_marked(schedule_passed=False, schedule_due_on="2026-09-17")


def test_legacy_pass_and_never_rated_stay_unmarked() -> None:
    today = date(2026, 9, 17)
    assert not legacy_unpassed_due_counts_as_marked(schedule_passed=True, schedule_due_on=today)
    assert not legacy_unpassed_due_counts_as_marked(
        schedule_passed=True,
        schedule_due_on=today + timedelta(days=3),
    )
    assert not legacy_unpassed_due_counts_as_marked(schedule_passed=False, schedule_due_on=None)
    assert not legacy_unpassed_due_counts_as_marked(schedule_passed=False, schedule_due_on="  ")


def test_due_kind_treats_missing_due_as_other() -> None:
    today = date(2026, 9, 17)
    assert schedule_due_kind(None, today=today) == "other"
    assert schedule_due_kind(today, today=today) == "due"
    assert schedule_due_kind(today + timedelta(days=2), today=today) == "other"
    assert question_is_due({"schedule_due_on": "2026-09-17"}, today=today) is True
    assert question_is_due({"schedule_due_on": None}, today=today) is False
