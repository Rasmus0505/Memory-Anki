"""Quiz 已做 survives a later read and ignores stale writes and delayed clears."""

import pytest

from memory_anki.modules.quiz.application.practice_progress import (
    clear_practice_progress,
    read_practice_progress,
    upsert_practice_progress,
)


def test_practice_progress_survives_read_and_rejects_a_stale_write_after_clear(db_session):
    upsert_practice_progress(
        db_session,
        [{
            "question_id": 41,
            "palace_id": 7,
            "state": {"resolved": True, "correct": True},
            "updated_at": "2026-08-01T00:00:00.000Z",
        }],
    )
    stored = read_practice_progress(db_session)
    assert stored["items"][0]["question_id"] == 41
    assert stored["items"][0]["state"]["resolved"] is True

    clear_practice_progress(
        db_session,
        palace_ids=[7],
        cleared_at="2026-08-01T01:00:00.000Z",
    )
    assert read_practice_progress(db_session)["items"] == []

    upsert_practice_progress(
        db_session,
        [{
            "question_id": 41,
            "palace_id": 7,
            "state": {"resolved": True},
            "updated_at": "2026-08-01T00:30:00.000Z",
        }],
    )
    assert read_practice_progress(db_session)["items"] == []

    upsert_practice_progress(
        db_session,
        [{
            "question_id": 41,
            "palace_id": 7,
            "state": {"resolved": True, "correct": False},
            "updated_at": "2026-08-01T02:00:00.000Z",
        }],
    )
    again = read_practice_progress(db_session)
    assert again["items"][0]["state"]["correct"] is False


@pytest.mark.parametrize("scope", [{"clear_all": True}, {"palace_ids": [7]}, {"question_ids": [41]}])
def test_delayed_clear_preserves_answers_written_after_it(db_session, scope):
    upsert_practice_progress(
        db_session,
        [{
            "question_id": 41,
            "palace_id": 7,
            "state": {"resolved": True, "correct": True},
            "updated_at": "2026-08-01T02:00:00.000Z",
        }],
    )
    clear_practice_progress(
        db_session,
        **scope,
        cleared_at="2026-08-01T01:00:00.000Z",
    )
    stored = read_practice_progress(db_session)
    assert len(stored["items"]) == 1
    assert stored["items"][0]["updated_at"] == "2026-08-01T02:00:00.000Z"
