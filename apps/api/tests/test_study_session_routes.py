from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Palace, StudySession
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.sessions.presentation import router as sessions_router


class StudySessionRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_sessions_get_session = sessions_router.get_session
        self.original_dashboard_get_session = dashboard_router.get_session

        def get_test_session():
            return self.SessionLocal()

        sessions_router.get_session = get_test_session
        dashboard_router.get_session = get_test_session

        with self.SessionLocal() as session:
            palace = Palace(title="Memory Palace", description="")
            session.add(palace)
            session.commit()
            self.palace_id = palace.id

        app = FastAPI()
        app.include_router(sessions_router.router, prefix="/api/v1")
        app.include_router(dashboard_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        sessions_router.get_session = self.original_sessions_get_session
        dashboard_router.get_session = self.original_dashboard_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_create_patch_event_complete_and_lookup_by_target(self):
        response = self.client.post(
            "/api/v1/study-sessions",
            json={
                "id": "study-test-1",
                "scene": "practice",
                "target_type": "palace",
                "target_id": self.palace_id,
                "palace_id": self.palace_id,
                "title": "Practice Memory Palace",
                "started_at": "2026-07-02T08:00:00",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["status"], "active")

        response = self.client.patch(
            "/api/v1/study-sessions/study-test-1",
            json={
                "effective_seconds": 120,
                "progress": {
                    "reveal_map": {"node-1": "revealed"},
                    "red_node_ids": ["node-2"],
                    "completed": False,
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["progress"]["red_node_ids"], ["node-2"])

        response = self.client.post(
            "/api/v1/study-sessions/study-test-1/events",
            json={"events": [{"type": "progress", "at": "2026-07-02T08:01:00"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["events"][-1]["type"], "progress")

        response = self.client.get(
            f"/api/v1/study-sessions/by-target?target_type=palace&target_id={self.palace_id}&scene=practice"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["id"], "study-test-1")

        response = self.client.post(
            "/api/v1/study-sessions/study-test-1/complete",
            json={
                "effective_seconds": 180,
                "completion_method": "manual_complete",
                "ended_at": "2026-07-02T08:03:00",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["status"], "completed")
        self.assertEqual(response.json()["item"]["effective_seconds"], 180)

    def test_dashboard_reads_completed_study_sessions(self):
        now = datetime.combine(date.today(), datetime.min.time()) + timedelta(hours=9)
        with self.SessionLocal() as session:
            session.add(
                StudySession(
                    id="dashboard-study-session",
                    status="completed",
                    scene="quiz",
                    target_type="palace",
                    target_id=self.palace_id,
                    palace_id=self.palace_id,
                    title="Quiz Memory Palace",
                    started_at=now,
                    ended_at=now + timedelta(minutes=5),
                    effective_seconds=300,
                    progress_json="{}",
                    events_json="[]",
                    summary_json="{}",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/dashboard")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["today_total_review_duration_seconds"], 300)
        self.assertEqual(payload["today_learning_palaces"][0]["quiz_seconds"], 300)


if __name__ == "__main__":
    unittest.main()
