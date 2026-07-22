from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, StudySession
from memory_anki.modules.session.application.study_session_service import (
    create_completed_study_session_from_time_payload,
    list_study_sessions,
    patch_study_session,
    reclassify_ghost_formal_review_time_sessions,
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
                "completionMethod": "saved",
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
