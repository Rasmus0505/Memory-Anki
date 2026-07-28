import json
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, StudySession
from memory_anki.modules.session.application.study_session_bridge import (
    reclassify_ghost_formal_review_time_sessions,
)
from memory_anki.modules.session.application.study_session_service import (
    create_completed_study_session_from_time_payload,
    list_study_sessions,
    patch_study_session,
    summarize_study_sessions_by_client_source,
)


def build_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_completed_time_payload_persists_client_source_in_summary():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        item = create_completed_study_session_from_time_payload(
            session,
            {
                "id": "mobile-record",
                "kind": "practice",
                "palaceId": None,
                "title": "Mobile study",
                "startedAt": "2026-07-09T08:00:00",
                "endedAt": "2026-07-09T08:10:00",
                "effectiveSeconds": 600,
                "clientSource": "mobile",
                "events": [],
            },
        )

        assert item is not None
        assert item["summary"]["client_source"] == "pwa"

        persisted = session.query(StudySession).filter_by(id="mobile-record").one()
        assert '"client_source": "pwa"' in persisted.summary_json


def test_source_summary_and_started_range_filter():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "desktop-range",
                "kind": "practice",
                "title": "Desktop",
                "startedAt": "2026-07-09T08:00:00",
                "endedAt": "2026-07-09T08:10:00",
                "effectiveSeconds": 600,
                "clientSource": "desktop",
                "events": [],
            },
        )
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "pwa-range",
                "kind": "practice",
                "title": "PWA",
                "startedAt": "2026-07-09T09:00:00",
                "endedAt": "2026-07-09T09:05:00",
                "effectiveSeconds": 300,
                "clientSource": "pwa",
                "events": [],
            },
        )
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "unknown-range",
                "kind": "practice",
                "title": "Unknown",
                "startedAt": "2026-07-09T10:00:00",
                "endedAt": "2026-07-09T10:02:00",
                "effectiveSeconds": 120,
                "events": [],
            },
        )
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "outside-range",
                "kind": "practice",
                "title": "Outside",
                "startedAt": "2026-07-08T08:00:00",
                "endedAt": "2026-07-08T08:10:00",
                "effectiveSeconds": 999,
                "clientSource": "desktop",
                "events": [],
            },
        )

        summary = summarize_study_sessions_by_client_source(
            session,
            status="completed",
            started_from=datetime(2026, 7, 9, 0, 0, 0),
            started_to=datetime(2026, 7, 10, 0, 0, 0),
        )
        assert summary == {
            "total_effective_seconds": 1020,
            "desktop_effective_seconds": 600,
            "pwa_effective_seconds": 300,
            "unknown_effective_seconds": 120,
        }

        items = list_study_sessions(
            session,
            status="completed",
            started_from=datetime(2026, 7, 9, 0, 0, 0),
            started_to=datetime(2026, 7, 10, 0, 0, 0),
        )
        assert {item["id"] for item in items} == {
            "desktop-range",
            "pwa-range",
            "unknown-range",
        }


def test_patch_study_session_merges_summary_fields():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "desktop-record",
                "kind": "practice",
                "palaceId": None,
                "title": "Desktop study",
                "startedAt": "2026-07-09T08:00:00",
                "endedAt": "2026-07-09T08:10:00",
                "effectiveSeconds": 600,
                "clientSource": "desktop",
                "sceneSegments": [{"scene": "practice"}],
                "events": [],
            },
        )

        item = patch_study_session(
            session,
            "desktop-record",
            {"summary": {"duration_edited": True}},
        )

        assert item is not None
        assert item["summary"]["client_source"] == "desktop"
        assert item["summary"]["scene_segments"] == [{"scene": "practice"}]
        assert item["summary"]["duration_edited"] is True


def test_review_timer_ghost_payload_is_stored_as_practice():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        item = create_completed_study_session_from_time_payload(
            session,
            {
                "id": "ghost-review-leave",
                "kind": "review",
                "palaceId": 35,
                "title": "俄国近代教育",
                "startedAt": "2026-07-19T20:00:00",
                "endedAt": "2026-07-19T20:10:00",
                "effectiveSeconds": 600,
                "completionMethod": "left_page",
                "events": [],
            },
        )

        assert item is not None
        assert item["scene"] == "practice"
        assert item["completion_method"] == "left_page"
        assert item["summary"]["reclassified_from"] == "review_timer_ghost"
        assert item["summary"]["original_kind"] == "review"

        persisted = session.query(StudySession).filter_by(id="ghost-review-leave").one()
        assert persisted.scene == "practice"


def test_reclassify_existing_ghost_formal_review_time_sessions():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "legacy-ghost",
                "kind": "practice",
                "palaceId": 35,
                "title": "俄国近代教育",
                "startedAt": "2026-07-19T21:00:00",
                "endedAt": "2026-07-19T21:05:00",
                "effectiveSeconds": 300,
                "completionMethod": "left_page",
                "events": [],
            },
        )
        row = session.query(StudySession).filter_by(id="legacy-ghost").one()
        row.scene = "review"
        session.commit()

        fixed = reclassify_ghost_formal_review_time_sessions(session)
        session.commit()

        assert fixed == 1
        refreshed = session.query(StudySession).filter_by(id="legacy-ghost").one()
        assert refreshed.scene == "practice"
        assert '"reclassified_from": "review_timer_ghost"' in refreshed.summary_json


def test_autosave_time_payload_stays_active_checkpoint_not_completed_list():
    from memory_anki.modules.session.application.study_session_bridge import (
        demote_autosave_checkpoint_time_records,
    )

    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        item = create_completed_study_session_from_time_payload(
            session,
            {
                "id": "autosave-checkpoint",
                "kind": "quiz",
                "title": "随心模式",
                "startedAt": "2026-07-23T16:24:42",
                "endedAt": "2026-07-23T16:25:27",
                "effectiveSeconds": 45,
                "completionMethod": "saved",
                "clientSource": "pwa",
                "events": [],
            },
        )
        assert item is not None
        assert item["status"] == "active"
        assert item["completion_method"] == "saved"
        assert item["ended_at"] is None

        completed = list_study_sessions(session, status="completed")
        assert all(row["id"] != "autosave-checkpoint" for row in completed)

        # Historical rows already written as completed+saved are demoted.
        legacy = StudySession(
            id="legacy-saved-complete",
            status="completed",
            scene="quiz",
            title="随心模式",
            started_at=datetime(2026, 7, 23, 16, 0, 0),
            ended_at=datetime(2026, 7, 23, 16, 1, 0),
            effective_seconds=30,
            completion_method="saved",
            summary_json='{"client_source":"pwa"}',
        )
        session.add(legacy)
        session.commit()

        demoted = demote_autosave_checkpoint_time_records(session)
        session.commit()
        assert demoted == 1
        assert session.query(StudySession).filter_by(id="legacy-saved-complete").one().status == "abandoned"


def test_finalize_after_autosave_checkpoint_marks_completed():
    SessionLocal = build_session_factory()

    with SessionLocal() as session:
        create_completed_study_session_from_time_payload(
            session,
            {
                "id": "freestyle-1",
                "kind": "quiz",
                "title": "随心模式",
                "startedAt": "2026-07-23T16:50:30",
                "endedAt": "2026-07-23T16:51:00",
                "effectiveSeconds": 30,
                "completionMethod": "saved",
                "events": [],
            },
        )
        final = create_completed_study_session_from_time_payload(
            session,
            {
                "id": "freestyle-1",
                "kind": "quiz",
                "title": "随心模式",
                "startedAt": "2026-07-23T16:50:30",
                "endedAt": "2026-07-23T17:06:51",
                "effectiveSeconds": 849,
                "completionMethod": "left_page",
                "events": [],
            },
        )
        assert final is not None
        assert final["status"] == "completed"
        assert final["completion_method"] == "left_page"
        assert final["effective_seconds"] == 849
        persisted = session.query(StudySession).filter_by(id="freestyle-1").one()
        assert persisted.status == "completed"
        assert persisted.completion_method == "left_page"


def test_backfill_missing_client_source_on_unit_review_only():
    from memory_anki.modules.session.application.study_session_bridge import (
        backfill_missing_client_source_on_study_sessions,
    )

    SessionLocal = build_session_factory()
    with SessionLocal() as session:
        session.add(
            StudySession(
                id="unit-missing",
                status="completed",
                scene="freestyle_unit_review",
                title="单元",
                started_at=datetime(2026, 7, 28, 10, 0, 0),
                ended_at=datetime(2026, 7, 28, 10, 5, 0),
                effective_seconds=300,
                completion_method="all_units_passed",
                summary_json='{"completed_unit_count":1}',
            )
        )
        session.add(
            StudySession(
                id="timer-missing",
                status="completed",
                scene="quiz",
                title="随心模式",
                started_at=datetime(2026, 7, 28, 10, 0, 0),
                ended_at=datetime(2026, 7, 28, 10, 5, 0),
                effective_seconds=300,
                completion_method="left_page",
                summary_json="{}",
            )
        )
        session.add(
            StudySession(
                id="already-pwa",
                status="completed",
                scene="quiz",
                title="PWA",
                started_at=datetime(2026, 7, 28, 10, 0, 0),
                ended_at=datetime(2026, 7, 28, 10, 5, 0),
                effective_seconds=100,
                completion_method="left_page",
                summary_json='{"client_source":"pwa"}',
            )
        )
        session.commit()

        fixed = backfill_missing_client_source_on_study_sessions(
            session,
            default_source="desktop",
            only_unit_review=True,
        )
        session.commit()
        assert fixed == 1
        unit = session.query(StudySession).filter_by(id="unit-missing").one()
        unit_summary = json.loads(unit.summary_json or "{}")
        assert unit_summary.get("client_source") == "desktop"
        assert session.query(StudySession).filter_by(id="timer-missing").one().summary_json == "{}"
        already = json.loads(
            session.query(StudySession).filter_by(id="already-pwa").one().summary_json or "{}"
        )
        assert already.get("client_source") == "pwa"


def test_demote_inflated_hang_sessions_caps_segments_and_abandons_overnight():
    from memory_anki.modules.session.application.study_session_bridge import (
        demote_inflated_hang_study_sessions,
    )

    SessionLocal = build_session_factory()
    with SessionLocal() as session:
        session.add(
            StudySession(
                id="overnight-hang",
                status="completed",
                scene="quiz",
                title="挂机",
                started_at=datetime(2026, 7, 23, 1, 0, 0),
                ended_at=datetime(2026, 7, 23, 12, 0, 0),
                effective_seconds=40_000,
                completion_method="left_page",
                summary_json='{"client_source":"pwa"}',
            )
        )
        session.add(
            StudySession(
                id="segment-cap",
                status="completed",
                scene="quiz",
                title="有片段",
                started_at=datetime(2026, 7, 23, 8, 0, 0),
                ended_at=datetime(2026, 7, 23, 14, 0, 0),
                effective_seconds=20_000,
                completion_method="left_page",
                summary_json='{"scene_segments":[{"effectiveSeconds":1500}]}',
            )
        )
        session.add(
            StudySession(
                id="edited-keep",
                status="completed",
                scene="quiz",
                title="手改",
                started_at=datetime(2026, 7, 23, 8, 0, 0),
                ended_at=datetime(2026, 7, 23, 14, 0, 0),
                effective_seconds=20_000,
                completion_method="manual_complete",
                summary_json='{"duration_edited":true}',
            )
        )
        session.commit()

        result = demote_inflated_hang_study_sessions(session)
        session.commit()

        assert result["demoted"] == 1
        assert result["capped"] == 1
        assert result["skipped"] == 1
        assert session.query(StudySession).filter_by(id="overnight-hang").one().status == "abandoned"
        capped = session.query(StudySession).filter_by(id="segment-cap").one()
        assert capped.status == "completed"
        assert capped.effective_seconds == 1500
        assert session.query(StudySession).filter_by(id="edited-keep").one().effective_seconds == 20_000
