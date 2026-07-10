from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, StudySession
from memory_anki.modules.sessions.application.study_session_service import (
    create_completed_study_session_from_time_payload,
    patch_study_session,
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
