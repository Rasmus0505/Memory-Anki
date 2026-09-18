from datetime import date, timedelta

from memory_anki.modules.quiz.application.question_scheduler import (
    apply_first_learning_rating,
    question_is_due,
    schedule_due_kind,
)


def test_first_learning_remember_schedules_tomorrow() -> None:
    today = date(2026, 9, 17)
    result = apply_first_learning_rating(3, today=today)
    assert result.passed is True
    assert result.stage == 1
    assert result.due_on == today + timedelta(days=1)


def test_first_learning_easy_schedules_three_days() -> None:
    today = date(2026, 9, 17)
    result = apply_first_learning_rating("轻松", today=today)
    assert result.passed is True
    assert result.stage == 2
    assert result.due_on == today + timedelta(days=3)


def test_first_learning_fail_stays_due_today() -> None:
    today = date(2026, 9, 17)
    forgotten = apply_first_learning_rating(1, today=today)
    hard = apply_first_learning_rating(2, today=today)
    assert forgotten.passed is False
    assert forgotten.due_on == today
    assert hard.passed is False
    assert hard.due_on == today


def test_due_kind_treats_missing_due_as_other() -> None:
    today = date(2026, 9, 17)
    assert schedule_due_kind(None, today=today) == "other"
    assert schedule_due_kind(today, today=today) == "due"
    assert schedule_due_kind(today + timedelta(days=2), today=today) == "other"
    assert question_is_due({"schedule_due_on": "2026-09-17"}, today=today) is True
    assert question_is_due({"schedule_due_on": None}, today=today) is False
