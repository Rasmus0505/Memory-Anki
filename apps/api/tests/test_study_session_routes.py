from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.sessions.presentation import router as sessions_router
from support import RouterTestCase


class StudySessionRouteTests(RouterTestCase):
    ROUTER_MODULES = (sessions_router, dashboard_router)

    def seed(self, session):
        palace = Palace(title="Memory Palace", description="")
        session.add(palace)
        session.commit()
        self.palace_id = palace.id

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

    def test_study_session_stats_lock_completed_not_deleted_positive_scene_scope(self):
        today_start = datetime.combine(date.today(), datetime.min.time())
        with self.SessionLocal() as session:
            session.add_all(
                [
                    StudySession(
                        id="stats-review",
                        status="completed",
                        scene="review",
                        target_type="palace",
                        palace_id=self.palace_id,
                        started_at=today_start + timedelta(hours=1),
                        effective_seconds=120,
                    ),
                    StudySession(
                        id="stats-practice",
                        status="completed",
                        scene="practice",
                        target_type="palace",
                        palace_id=self.palace_id,
                        started_at=today_start + timedelta(hours=2),
                        effective_seconds=180,
                    ),
                    StudySession(
                        id="stats-negative",
                        status="completed",
                        scene="review",
                        target_type="palace",
                        palace_id=self.palace_id,
                        started_at=today_start + timedelta(hours=3),
                        effective_seconds=-90,
                    ),
                    StudySession(
                        id="stats-active",
                        status="active",
                        scene="review",
                        target_type="palace",
                        palace_id=self.palace_id,
                        started_at=today_start + timedelta(hours=4),
                        effective_seconds=240,
                    ),
                    StudySession(
                        id="stats-deleted",
                        status="completed",
                        scene="review",
                        target_type="palace",
                        palace_id=self.palace_id,
                        started_at=today_start + timedelta(hours=5),
                        effective_seconds=300,
                        deleted_at=today_start + timedelta(hours=6),
                    ),
                    StudySession(
                        id="stats-other-scene",
                        status="completed",
                        scene="english",
                        target_type="none",
                        started_at=today_start + timedelta(hours=7),
                        effective_seconds=360,
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/study-sessions/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "today_total_seconds": 300,
                "weekly_total_seconds": 300,
                "today_review_seconds": 120,
                "weekly_review_seconds": 120,
            },
        )

    def test_list_study_sessions_keeps_default_shape_and_supports_pagination(self):
        base = datetime(2026, 7, 2, 8, 0, 0)
        with self.SessionLocal() as session:
            session.add_all(
                [
                    StudySession(
                        id="oldest-session",
                        status="completed",
                        scene="practice",
                        target_type="palace",
                        target_id=self.palace_id,
                        palace_id=self.palace_id,
                        title="Oldest",
                        started_at=base,
                        progress_json="{}",
                        events_json="[]",
                        summary_json="{}",
                    ),
                    StudySession(
                        id="middle-session",
                        status="completed",
                        scene="practice",
                        target_type="palace",
                        target_id=self.palace_id,
                        palace_id=self.palace_id,
                        title="Middle",
                        started_at=base + timedelta(minutes=5),
                        progress_json="{}",
                        events_json="[]",
                        summary_json="{}",
                    ),
                    StudySession(
                        id="newest-session",
                        status="completed",
                        scene="practice",
                        target_type="palace",
                        target_id=self.palace_id,
                        palace_id=self.palace_id,
                        title="Newest",
                        started_at=base + timedelta(minutes=10),
                        progress_json="{}",
                        events_json="[]",
                        summary_json="{}",
                    ),
                    StudySession(
                        id="deleted-session",
                        status="completed",
                        scene="practice",
                        target_type="palace",
                        target_id=self.palace_id,
                        palace_id=self.palace_id,
                        title="Deleted",
                        started_at=base + timedelta(minutes=15),
                        progress_json="{}",
                        events_json="[]",
                        summary_json="{}",
                        deleted_at=base + timedelta(minutes=20),
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/study-sessions")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), {"items"})
        self.assertEqual(
            [item["id"] for item in payload["items"]],
            ["newest-session", "middle-session", "oldest-session"],
        )

        response = self.client.get("/api/v1/study-sessions?limit=1&offset=1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["limit"], 1)
        self.assertEqual(payload["offset"], 1)
        self.assertEqual([item["id"] for item in payload["items"]], ["middle-session"])

    def test_list_study_sessions_rejects_invalid_pagination(self):
        for query in (
            "limit=0",
            "limit=501",
            "limit=1&offset=-1",
            "limit=20&sort_by=unknown",
            "limit=20&sort_order=sideways",
            "limit=20&status=unknown",
        ):
            response = self.client.get(f"/api/v1/study-sessions?{query}")
            self.assertEqual(response.status_code, 422)

    def test_list_study_sessions_filters_completed_records(self):
        base = datetime(2026, 7, 2, 8, 0, 0)
        with self.SessionLocal() as session:
            session.add_all(
                [
                    StudySession(
                        id="completed-history-record",
                        status="completed",
                        scene="review",
                        target_type="none",
                        title="Completed",
                        started_at=base,
                    ),
                    StudySession(
                        id="session-progress-review-42",
                        status="abandoned",
                        scene="review",
                        target_type="review_schedule",
                        target_id=42,
                        title="",
                        started_at=base + timedelta(minutes=1),
                    ),
                ]
            )
            session.commit()

        response = self.client.get(
            "/api/v1/study-sessions?limit=20&offset=0&status=completed"
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(
            [item["id"] for item in payload["items"]],
            ["completed-history-record"],
        )

    def test_list_study_sessions_filters_and_sorts_paginated_results(self):
        base = datetime(2026, 7, 2, 8, 0, 0)
        with self.SessionLocal() as session:
            session.add_all(
                [
                    StudySession(
                        id="practice-short",
                        status="completed",
                        scene="practice",
                        target_type="none",
                        title="Alpha practice",
                        started_at=base,
                        effective_seconds=60,
                    ),
                    StudySession(
                        id="practice-long",
                        status="completed",
                        scene="english",
                        target_type="none",
                        title="Beta practice",
                        started_at=base + timedelta(minutes=1),
                        effective_seconds=600,
                    ),
                    StudySession(
                        id="review-session",
                        status="completed",
                        scene="review",
                        target_type="none",
                        title="Alpha review",
                        started_at=base + timedelta(minutes=2),
                        effective_seconds=300,
                    ),
                ]
            )
            session.commit()

        response = self.client.get(
            "/api/v1/study-sessions?limit=20&offset=0&keyword=practice"
            "&kind=practice&sort_by=effective_seconds&sort_order=asc"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual(
            [item["id"] for item in payload["items"]],
            ["practice-short", "practice-long"],
        )

        response = self.client.get(
            "/api/v1/study-sessions?limit=20&offset=0&sort_by=title&sort_order=desc"
        )
        self.assertEqual(
            [item["id"] for item in response.json()["items"]],
            ["practice-long", "review-session", "practice-short"],
        )

    def test_time_record_analytics_returns_zero_filled_trend_and_breakdown(self):
        today = date.today()
        today_start = datetime.combine(today, datetime.min.time())
        with self.SessionLocal() as session:
            session.add_all(
                [
                    StudySession(
                        id="analytics-practice",
                        status="completed",
                        scene="practice",
                        target_type="none",
                        title="Practice",
                        started_at=today_start,
                        effective_seconds=120,
                    ),
                    StudySession(
                        id="analytics-review",
                        status="completed",
                        scene="segment_review",
                        target_type="none",
                        title="Review",
                        started_at=today_start - timedelta(days=2),
                        effective_seconds=300,
                    ),
                    StudySession(
                        id="analytics-deleted",
                        status="completed",
                        scene="quiz",
                        target_type="none",
                        title="Deleted",
                        started_at=today_start,
                        effective_seconds=999,
                        deleted_at=today_start,
                    ),
                ]
            )
            session.commit()

        response = self.client.get(
            "/api/v1/study-sessions/time-record-analytics"
            "?trend_range=7&breakdown_range=all"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["trend"]), 7)
        self.assertEqual(payload["trend"][-1]["seconds"], 120)
        self.assertEqual(payload["trend"][-3]["seconds"], 300)
        breakdown = {item["kind"]: item for item in payload["breakdown"]}
        self.assertEqual(breakdown["practice"]["seconds"], 120)
        self.assertEqual(breakdown["review"]["seconds"], 300)
        self.assertEqual(breakdown["quiz"]["sessions"], 0)


if __name__ == "__main__":
    unittest.main()
