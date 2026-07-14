from datetime import datetime

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceSegment,
    ReviewLog,
    ReviewSchedule,
    ReviewStageAdjustment,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_palace_review_schedules,
)
from memory_anki.modules.reviews.presentation import router as review_router
from support import RouterTestCase


class ReviewStageAdjustmentRouteTests(RouterTestCase):
    ROUTER_MODULES = (review_router,)

    def seed(self, session):
        palace = Palace(
            title="Adjustable Palace",
            description="",
            review_mode="review",
            created_at=datetime(2026, 7, 1, 9, 0),
        )
        session.add(palace)
        session.flush()
        session.add(
            PalaceSegment(
                palace_id=palace.id,
                name="Learning Group",
                needs_practice=True,
            )
        )
        rebuild_palace_review_schedules(
            session,
            palace,
            completed_count=2,
            completed_at=datetime(2026, 7, 2, 10, 0),
        )
        session.commit()

    def test_preview_does_not_persist_schedule_or_palace_changes(self):
        response = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment/preview",
            json={
                "target_completed_count": 4,
                "completed_at": "2026-07-14T14:30",
                "needs_practice": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["direction"], "forward")
        self.assertEqual(payload["previous_completed_count"], 2)
        self.assertEqual(payload["target_completed_count"], 4)
        self.assertEqual(len(payload["added_stage_labels"]), 2)
        self.assertIsNotNone(payload["next_review_at"])

        with self.SessionLocal() as session:
            completed = session.query(ReviewSchedule).filter_by(completed=True).count()
            palace = session.query(Palace).filter_by(id=1).one()
            self.assertEqual(completed, 2)
            self.assertFalse(palace.needs_practice)
            self.assertEqual(session.query(ReviewStageAdjustment).count(), 0)

    def test_apply_moves_progress_without_creating_review_statistics(self):
        response = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers={"X-Memory-Anki-Mutation-ID": "stage-adjust-forward-1"},
            json={
                "target_completed_count": 4,
                "completed_at": "2026-07-14T14:30",
                "needs_practice": True,
                "expected_completed_count": 2,
                "note": "补录线下复习",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["target_completed_count"], 4)
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).one()
            schedules = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1)
                .order_by(ReviewSchedule.review_number)
                .all()
            )
            adjustment = session.query(ReviewStageAdjustment).one()
            segment = session.query(PalaceSegment).one()
            self.assertEqual(sum(schedule.completed for schedule in schedules), 4)
            self.assertTrue(palace.needs_practice)
            self.assertEqual(adjustment.previous_completed_count, 2)
            self.assertEqual(adjustment.target_completed_count, 4)
            self.assertEqual(adjustment.note, "补录线下复习")
            self.assertTrue(segment.needs_practice)
            self.assertEqual(session.query(ReviewLog).count(), 0)
            self.assertEqual(session.query(StudySession).count(), 0)

    def test_apply_can_rollback_and_reset(self):
        rollback = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers={"X-Memory-Anki-Mutation-ID": "stage-adjust-backward-1"},
            json={
                "target_completed_count": 1,
                "completed_at": "2026-07-02T09:30",
                "needs_practice": False,
                "expected_completed_count": 2,
            },
        )
        self.assertEqual(rollback.status_code, 200)
        self.assertEqual(rollback.json()["direction"], "backward")

        reset = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers={"X-Memory-Anki-Mutation-ID": "stage-adjust-reset-1"},
            json={
                "target_completed_count": 0,
                "completed_at": None,
                "needs_practice": False,
                "expected_completed_count": 1,
            },
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["direction"], "reset")
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).one()
            schedules = session.query(ReviewSchedule).filter_by(palace_id=1).all()
            self.assertFalse(palace.mastered)
            self.assertEqual(sum(schedule.completed for schedule in schedules), 0)
            self.assertGreaterEqual(len(schedules), 1)

    def test_conflict_and_idempotency_are_enforced(self):
        payload = {
            "target_completed_count": 3,
            "completed_at": "2026-07-14T15:00",
            "needs_practice": False,
            "expected_completed_count": 2,
        }
        headers = {"X-Memory-Anki-Mutation-ID": "stage-adjust-idempotent-1"}
        first = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers=headers,
            json=payload,
        )
        second = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers=headers,
            json=payload,
        )
        conflict = self.client.post(
            "/api/v1/review/palaces/1/stage-adjustment",
            headers={"X-Memory-Anki-Mutation-ID": "stage-adjust-conflict-1"},
            json={**payload, "target_completed_count": 4},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), first.json())
        self.assertEqual(conflict.status_code, 409)
        with self.SessionLocal() as session:
            self.assertEqual(session.query(ReviewStageAdjustment).count(), 1)
