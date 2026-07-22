from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, StudySession
from memory_anki.modules.session.application.study_session_service import (
    create_completed_study_session_from_time_payload,
    patch_study_session,
    reclassify_ghost_formal_review_time_sessions,
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
