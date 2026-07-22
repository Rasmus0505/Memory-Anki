"""FSRS-only review route coverage (legacy ReviewSchedule paths removed)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.memory.presentation import router as review_router
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.platform.application import MUTATION_ID_HEADER
from support import RouterTestCase

EDITOR_DOC = json.dumps(
    {
        "root": {
            "data": {"text": "Test Palace", "uid": "root"},
            "children": [
                {"data": {"text": "Branch A", "note": "Detail A", "uid": "branch-a"}, "children": []},
                {"data": {"text": "Branch B", "uid": "branch-b"}, "children": []},
            ],
        }
    }
)


class ReviewRouteTests(RouterTestCase):
    ROUTER_MODULES = (review_router, palace_router, settings_router)

    def seed(self, session):
        palace = Palace(
            title="Test Palace",
            description="",
            difficulty=0,
            review_mode="review",
            editor_doc=EDITOR_DOC,
        )
        session.add(palace)
        session.flush()
        # Wave formal queue only counts initialized memory nodes.
        past = utc_now_naive() - timedelta(days=1)
        for uid in ("branch-a", "branch-b"):
            session.add(
                ReviewNodeState(
                    palace_id=palace.id,
                    node_uid=uid,
                    state=2,
                    stability=3.0,
                    difficulty=5.0,
                    due_at=past,
                    raw_due_at=past,
                    last_review_at=past - timedelta(days=3),
                    schedule_source="manual",
                    content_fingerprint="",
                )
            )
        session.commit()

    def test_legacy_stage_runtime_routes_are_removed(self):
        requests = (
            self.client.post("/api/v1/review/spread-overdue", json={"days": 7}),
            self.client.post("/api/v1/review/spread-overdue/undo", json={}),
            self.client.get("/api/v1/review/stage-progress-health"),
        )
        for response in requests:
            # Missing routes may be 404 or method-not-allowed 405 depending on router catch-alls.
            self.assertIn(response.status_code, {404, 405})

    def test_queue_lists_due_fsrs_nodes(self):
        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["due_count"], 2)
        self.assertEqual(len(payload["reviews"]), 1)
        self.assertEqual(payload["reviews"][0]["algorithm_used"], "FSRS")
        self.assertIn(payload["reviews"][0]["review_entry_mode"], {"node", "palace"})

    def test_overdue_count_matches_queue(self):
        queue = self.client.get("/api/v1/review/queue").json()
        overdue = self.client.get("/api/v1/review/overdue-count").json()
        self.assertEqual(overdue["count"], queue["overdue_count"])

    def test_load_forecast_days_is_clamped(self):
        response = self.client.get("/api/v1/review/load-forecast?days=999")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["days"], 60)

    def test_review_notes_route_returns_recent_notes(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).one()
            session.add(
                ReviewLog(
                    palace_id=palace.id,
                    review_date=datetime.now(UTC).date(),
                    score=3,
                    review_mode="fsrs",
                    duration_seconds=20,
                    note="卡壳在分支 A",
                )
            )
            session.commit()
        response = self.client.get("/api/v1/review/notes")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(items[0]["note"], "卡壳在分支 A")

    def test_start_session_and_submit_persists_note(self):
        with self.SessionLocal() as session:
            palace_id = session.query(Palace).one().id
        start = self.client.post(f"/api/v1/review/palaces/{palace_id}/sessions", json={})
        self.assertEqual(start.status_code, 200)
        session_id = start.json()["session_id"]
        self.assertTrue(str(session_id).startswith("review-"))

        # Wave rule: rate frozen nodes before complete (bulk settlement).
        rate = self.client.post(
            f"/api/v1/review/session/{session_id}/rate-unrated",
            json={"rating": 3, "operation_id": "route-settlement-note"},
        )
        self.assertEqual(rate.status_code, 200)

        submit = self.client.post(
            f"/api/v1/review/session/{session_id}/submit",
            json={
                "duration_seconds": 12,
                "completion_mode": "manual_complete",
                "note": "  瓣膜顺序卡壳  ",
            },
        )
        self.assertEqual(submit.status_code, 200)
        self.assertTrue(submit.json()["ok"])

        with self.SessionLocal() as session:
            log = session.query(ReviewLog).one()
            self.assertEqual(log.note, "瓣膜顺序卡壳")

    def test_submit_reuses_response_for_duplicate_mutation_id(self):
        with self.SessionLocal() as session:
            palace_id = session.query(Palace).one().id
        start = self.client.post(f"/api/v1/review/palaces/{palace_id}/sessions", json={})
        session_id = start.json()["session_id"]
        self.assertEqual(
            self.client.post(
                f"/api/v1/review/session/{session_id}/rate-unrated",
                json={"rating": 3, "operation_id": "route-settlement-dup"},
            ).status_code,
            200,
        )
        headers = {MUTATION_ID_HEADER: "review-submit-dup"}
        body = {"duration_seconds": 8, "completion_mode": "manual_complete"}
        first = self.client.post(
            f"/api/v1/review/session/{session_id}/submit",
            json=body,
            headers=headers,
        )
        second = self.client.post(
            f"/api/v1/review/session/{session_id}/submit",
            json=body,
            headers=headers,
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), first.json())
        with self.SessionLocal() as session:
            self.assertEqual(session.query(ReviewLog).count(), 1)

    def test_memory_projection_endpoint(self):
        with self.SessionLocal() as session:
            palace_id = session.query(Palace).one().id
        response = self.client.get(f"/api/v1/review/palaces/{palace_id}/memory")
        self.assertEqual(response.status_code, 200)
        item = response.json()["item"]
        self.assertEqual(item["due_node_count"], 2)
        self.assertIn("review_entry_mode", item)

    def test_review_session_includes_editor_doc(self):
        with self.SessionLocal() as session:
            palace_id = session.query(Palace).one().id
        start = self.client.post(f"/api/v1/review/palaces/{palace_id}/sessions", json={})
        session_id = start.json()["session_id"]
        response = self.client.get(f"/api/v1/review/session/{session_id}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["palace"]["title"], "Test Palace")
        self.assertIn("editor_doc", payload["palace"])

    def test_soft_deleted_palace_is_excluded_from_queue(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).one()
            palace.deleted_at = datetime.now(UTC).replace(tzinfo=None)
            session.commit()
        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["due_count"], 0)
        self.assertEqual(response.json()["reviews"], [])

    def test_archived_palace_is_excluded_from_queue(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).one()
            palace.archived = True
            session.commit()
        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["due_count"], 0)
