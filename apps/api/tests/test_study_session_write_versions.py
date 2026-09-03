from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.modules.session.application.study_session_bridge import (
    create_completed_study_session_from_time_payload,
)
from memory_anki.modules.session.application.study_session_service import (
    complete_study_session,
    create_study_session,
    patch_study_session,
)


def test_revision_and_operation_id_make_sparse_checkpoints_idempotent(db_session):
    started_at = utc_now_naive() - timedelta(minutes=2)
    first = create_study_session(
        db_session,
        {
            "id": "versioned-session",
            "session_key": "palace:7",
            "client_revision": 1,
            "operation_id": "start-1",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "effective_seconds": 10,
        },
    )
    assert first["client_revision"] == 1
    assert first["last_operation_id"] == "start-1"

    # Equal revision is already handled, even when a different request arrives.
    stale = patch_study_session(
        db_session,
        "versioned-session",
        {
            "client_revision": 1,
            "operation_id": "late-1",
            "effective_seconds": 999,
        },
    )
    assert stale is not None
    assert stale["effective_seconds"] == 10

    accepted = patch_study_session(
        db_session,
        "versioned-session",
        {
            "client_revision": 2,
            "operation_id": "checkpoint-2",
            "effective_seconds": 20,
        },
    )
    assert accepted is not None
    assert accepted["client_revision"] == 2
    assert accepted["last_operation_id"] == "checkpoint-2"
    assert accepted["effective_seconds"] == 20

    duplicate = patch_study_session(
        db_session,
        "versioned-session",
        {
            "client_revision": 3,
            "operation_id": "checkpoint-2",
            "effective_seconds": 0,
        },
    )
    assert duplicate is not None
    assert duplicate["effective_seconds"] == 20
    assert db_session.get(StudySession, "versioned-session").client_revision == 2


def test_terminal_write_rejects_late_active_checkpoint(db_session):
    started_at = utc_now_naive() - timedelta(minutes=5)
    create_study_session(
        db_session,
        {
            "id": "terminal-versioned",
            "session_key": "freestyle",
            "client_revision": 1,
            "operation_id": "start-1",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "effective_seconds": 10,
        },
    )
    completed = complete_study_session(
        db_session,
        "terminal-versioned",
        {
            "client_revision": 3,
            "operation_id": "complete-3",
            "ended_at": utc_now_naive().isoformat(),
            "effective_seconds": 120,
            "completion_method": "manual_complete",
        },
    )
    assert completed is not None
    assert completed["status"] == "completed"

    late = patch_study_session(
        db_session,
        "terminal-versioned",
        {
            "client_revision": 2,
            "operation_id": "autosave-2",
            "status": "active",
            "effective_seconds": 999,
        },
    )
    assert late is not None
    assert late["status"] == "completed"
    assert late["effective_seconds"] == 120
    assert late["last_operation_id"] == "complete-3"


def test_manual_duration_edit_escapes_wall_clock_cap_but_invalid_range_still_fails(db_session):
    item = create_completed_study_session_from_time_payload(
        db_session,
        {
            "id": "manual-duration",
            "sessionKey": "english:4",
            "clientRevision": 1,
            "operationId": "manual-1",
            "kind": "practice",
            "startedAt": "2026-07-30T08:00:00",
            "endedAt": "2026-07-30T08:01:00",
            "effectiveSeconds": 999,
            "durationEdited": True,
            "completionMethod": "manual_complete",
        },
    )
    assert item is not None
    assert item["effective_seconds"] == 999
    assert item["session_key"] == "english:4"
    assert item["client_revision"] == 1

    try:
        create_completed_study_session_from_time_payload(
            db_session,
            {
                "id": "invalid-duration-range",
                "kind": "practice",
                "startedAt": "2026-07-30T08:02:00",
                "endedAt": "2026-07-30T08:01:00",
                "effectiveSeconds": 1,
                "durationEdited": True,
            },
        )
    except ValueError as exc:
        assert "开始时间不能晚于结束时间" in str(exc)
    else:
        raise AssertionError("expected invalid range to be rejected")


def test_from_time_record_duplicate_operation_does_not_replace_final_row(db_session):
    payload = {
        "id": "time-versioned",
        "sessionKey": "palace:7",
        "clientRevision": 4,
        "operationId": "complete-4",
        "kind": "practice",
        "startedAt": "2026-07-30T08:00:00",
        "endedAt": "2026-07-30T08:10:00",
        "effectiveSeconds": 600,
        "completionMethod": "manual_complete",
    }
    first = create_completed_study_session_from_time_payload(db_session, payload)
    second = create_completed_study_session_from_time_payload(
        db_session,
        {**payload, "effectiveSeconds": 1},
    )
    assert first is not None and second is not None
    assert second["effective_seconds"] == 600
    assert db_session.get(StudySession, "time-versioned").effective_seconds == 600


def test_legacy_completed_saved_row_is_terminal_against_late_saved_checkpoint(db_session):
    started_at = utc_now_naive() - timedelta(minutes=3)
    db_session.add(
        StudySession(
            id="legacy-saved-terminal",
            status="completed",
            scene="practice",
            target_type="none",
            started_at=started_at,
            ended_at=started_at + timedelta(seconds=60),
            effective_seconds=60,
            completion_method="saved",
            summary_json="{}",
            events_json="[]",
            progress_json="{}",
        )
    )
    db_session.commit()
    item = create_completed_study_session_from_time_payload(
        db_session,
        {
            "id": "legacy-saved-terminal",
            "kind": "practice",
            "startedAt": started_at.isoformat(),
            "endedAt": (started_at + timedelta(seconds=120)).isoformat(),
            "effectiveSeconds": 120,
            "completionMethod": "saved",
        },
    )
    assert item is not None
    assert item["effective_seconds"] == 60


def test_timer_review_payload_is_reclassified_without_submit_receipt(db_session):
    item = create_completed_study_session_from_time_payload(
        db_session,
        {
            "id": "review-timer-with-manual-label",
            "kind": "review",
            "startedAt": "2026-07-30T08:00:00",
            "endedAt": "2026-07-30T08:01:00",
            "effectiveSeconds": 60,
            "completionMethod": "manual_complete",
        },
    )
    assert item is not None
    assert item["scene"] == "practice"
    assert item["summary"]["reclassified_from"] == "review_timer_ghost"


def test_manual_history_review_payload_keeps_review_scene(db_session):
    item = create_completed_study_session_from_time_payload(
        db_session,
        {
            "id": "manual-review-history",
            "kind": "review",
            "startedAt": "2026-07-30T08:00:00",
            "endedAt": "2026-07-30T08:01:00",
            "effectiveSeconds": 120,
            "durationEdited": True,
            "completionMethod": "manual_complete",
        },
    )
    assert item is not None
    assert item["scene"] == "review"
    assert item["effective_seconds"] == 120


def test_string_false_duration_edit_does_not_bypass_wall_clock_cap(db_session):
    item = create_completed_study_session_from_time_payload(
        db_session,
        {
            "id": "string-duration-edit-false",
            "kind": "practice",
            "startedAt": "2026-07-30T08:00:00",
            "endedAt": "2026-07-30T08:01:00",
            "effectiveSeconds": 999,
            "durationEdited": "false",
            "completionMethod": "left_page",
        },
    )
    assert item is not None
    assert item["effective_seconds"] == 60


def test_explicit_history_duration_edit_is_allowed_at_same_revision(db_session):
    started_at = utc_now_naive() - timedelta(minutes=5)
    created = create_study_session(
        db_session,
        {
            "id": "history-edit-same-revision",
            "session_key": "palace:9",
            "client_revision": 4,
            "operation_id": "complete-4",
            "status": "completed",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "ended_at": (started_at + timedelta(seconds=30)).isoformat(),
            "effective_seconds": 30,
            "completion_method": "manual_complete",
        },
    )
    assert created["effective_seconds"] == 30

    edited = patch_study_session(
        db_session,
        "history-edit-same-revision",
        {
            "client_revision": 4,
            "operation_id": "history-edit-4",
            "effective_seconds": 900,
            "duration_edited": True,
        },
    )
    assert edited is not None
    assert edited["effective_seconds"] == 900
    assert edited["summary"]["duration_edited"] is True


def test_history_edit_does_not_regress_server_revision(db_session):
    started_at = utc_now_naive() - timedelta(minutes=5)
    create_study_session(
        db_session,
        {
            "id": "history-edit-low-revision",
            "session_key": "palace:11",
            "client_revision": 8,
            "operation_id": "complete-8",
            "status": "completed",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "ended_at": (started_at + timedelta(seconds=30)).isoformat(),
            "effective_seconds": 30,
            "completion_method": "manual_complete",
        },
    )

    edited = patch_study_session(
        db_session,
        "history-edit-low-revision",
        {
            "client_revision": 2,
            "operation_id": "history-edit-2",
            "effective_seconds": 900,
            "duration_edited": True,
        },
    )
    assert edited is not None
    assert edited["effective_seconds"] == 900
    assert edited["client_revision"] == 8


def test_late_timer_write_cannot_use_existing_duration_edit_flag(db_session):
    started_at = utc_now_naive() - timedelta(minutes=5)
    create_study_session(
        db_session,
        {
            "id": "history-edit-late-timer",
            "session_key": "palace:10",
            "client_revision": 1,
            "operation_id": "complete-1",
            "status": "completed",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "ended_at": (started_at + timedelta(seconds=30)).isoformat(),
            "effective_seconds": 900,
            "duration_edited": True,
            "completion_method": "manual_complete",
        },
    )

    late = create_study_session(
        db_session,
        {
            "id": "history-edit-late-timer",
            "session_key": "palace:10",
            "client_revision": 2,
            "operation_id": "timer-2",
            "status": "completed",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "ended_at": (started_at + timedelta(seconds=30)).isoformat(),
            "effective_seconds": 5,
            "completion_method": "manual_complete",
        },
    )
    assert late["effective_seconds"] == 900


def test_active_cumulative_duration_does_not_move_backwards(db_session):
    started_at = utc_now_naive() - timedelta(minutes=5)
    first = create_study_session(
        db_session,
        {
            "id": "active-monotonic",
            "session_key": "freestyle",
            "client_revision": 1,
            "operation_id": "tick-1",
            "status": "active",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "effective_seconds": 100,
        },
    )
    assert first["effective_seconds"] == 100

    late = patch_study_session(
        db_session,
        "active-monotonic",
        {
            "client_revision": 2,
            "operation_id": "tick-2",
            "status": "active",
            "effective_seconds": 10,
        },
    )
    assert late is not None
    assert late["effective_seconds"] == 100


def test_new_record_id_reuses_open_target_session_key(db_session):
    started_at = utc_now_naive() - timedelta(minutes=2)
    create_study_session(
        db_session,
        {
            "id": "legacy-open-id",
            "session_key": "palace:12",
            "client_revision": 1,
            "operation_id": "legacy-tick",
            "status": "active",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "effective_seconds": 10,
        },
    )

    completed = create_study_session(
        db_session,
        {
            "id": "new-after-reload-id",
            "session_key": "palace:12",
            "client_revision": 2,
            "operation_id": "final-after-reload",
            "status": "completed",
            "scene": "practice",
            "started_at": started_at.isoformat(),
            "ended_at": utc_now_naive().isoformat(),
            "effective_seconds": 30,
            "completion_method": "left_page",
        },
    )
    assert completed["id"] == "legacy-open-id"
    assert db_session.get(StudySession, "new-after-reload-id") is None
    assert db_session.get(StudySession, "legacy-open-id").status == "completed"
