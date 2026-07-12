import json
import tempfile
import unittest
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from memory_anki.infrastructure.db._tables import Base
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import (
    Config,
    StudySession,
)
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceSegment,
    PalaceVersion,
    Peg,
    ReviewLog,
    ReviewSchedule,
    SessionProgress,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    maybe_create_interval_backup,
)
from memory_anki.modules.backups.application.backup_palace_restore import (
    restore_palace_from_backup,
)
from memory_anki.modules.backups.application.backup_palace_snapshots import (
    export_palace_snapshot_comparison,
)
from memory_anki.modules.backups.application.backup_palace_versions import (
    create_palace_version,
)
from memory_anki.modules.palaces.application.editor_state_service import save_palace_editor_state
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.application.review_execution_service import (
    submit_review,
)
from memory_anki.modules.reviews.application.schedule_service import (
    ensure_current_review_schedule_model,
)
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.settings.presentation import router as settings_router
from support import RouterTestCase


def utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ReviewRouteTests(RouterTestCase):
    ROUTER_MODULES = (review_router, palace_router, settings_router)

    def seed(self, session):
        palace = Palace(
            title="Test Palace",
            description="",
            difficulty=0,
            review_mode="review",
            editor_doc=json.dumps(
                {
                    "root": {
                            "data": {"text": "Test Palace"},
                            "children": [
                            {"data": {"text": "Branch A", "note": "Detail A", "uid": "branch-a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "branch-b"}, "children": []},
                        ],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        create_palace_version(session, palace, "editor_save")
        session.add(
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=date.today() - timedelta(days=1),
                interval_days=1,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=0,
                review_type="standard",
            )
        )
        session.commit()

    def test_overdue_count_route_is_not_captured_by_schedule_id(self):
        response = self.client.get("/api/v1/review/overdue-count")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)

    def test_review_queries_do_not_unarchive_palaces(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).one()
            palace.archived = True
            session.commit()

        queue_response = self.client.get("/api/v1/review/queue")
        overdue_response = self.client.get("/api/v1/review/overdue-count")

        self.assertEqual(queue_response.status_code, 200)
        self.assertEqual(queue_response.json()["reviews"], [])
        self.assertEqual(overdue_response.status_code, 200)
        self.assertEqual(overdue_response.json()["count"], 0)
        with self.SessionLocal() as session:
            self.assertTrue(session.query(Palace).filter_by(id=1).one().archived)

    def test_soft_deleted_palace_is_excluded_from_review_surfaces(self):
        delete_response = self.client.delete("/api/v1/palaces/1")
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json(), {"ok": True})

        overdue_response = self.client.get("/api/v1/review/overdue-count")
        queue_response = self.client.get("/api/v1/review/queue")
        session_response = self.client.get("/api/v1/review/session/1")

        self.assertEqual(overdue_response.status_code, 200)
        self.assertEqual(overdue_response.json()["count"], 0)
        self.assertEqual(queue_response.status_code, 200)
        self.assertEqual(queue_response.json()["due_count"], 0)
        self.assertEqual(queue_response.json()["overdue_count"], 0)
        self.assertEqual(queue_response.json()["reviews"], [])
        self.assertEqual(session_response.status_code, 404)

    def test_load_forecast_counts_overdue_and_future_active_schedules(self):
        today = date.today()
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            archived_palace = Palace(title="Archived Palace", archived=True)
            mastered_palace = Palace(title="Mastered Palace", mastered=True)
            session.add_all([archived_palace, mastered_palace])
            session.flush()
            session.add_all(
                [
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=today,
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=1,
                        review_type="standard",
                    ),
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=today + timedelta(days=3),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=2,
                        review_type="standard",
                    ),
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=today + timedelta(days=3),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        review_number=3,
                        review_type="standard",
                    ),
                    ReviewSchedule(
                        palace_id=archived_palace.id,
                        scheduled_date=today + timedelta(days=3),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                    ReviewSchedule(
                        palace_id=mastered_palace.id,
                        scheduled_date=today + timedelta(days=3),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/review/load-forecast?days=7")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["days"], 7)
        self.assertEqual(payload["overdue_count"], 1)
        self.assertEqual(payload["total_upcoming"], 2)
        self.assertEqual(len(payload["items"]), 7)
        self.assertEqual(payload["items"][0]["date"], today.isoformat())
        self.assertTrue(payload["items"][0]["is_today"])
        self.assertEqual(payload["items"][0]["due_count"], 1)
        self.assertEqual(payload["items"][3]["date"], (today + timedelta(days=3)).isoformat())
        self.assertEqual(payload["items"][3]["due_count"], 1)

    def test_load_forecast_days_is_clamped(self):
        response = self.client.get("/api/v1/review/load-forecast?days=999")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["days"], 60)
        self.assertEqual(len(payload["items"]), 60)

    def test_review_notes_route_returns_recent_notes_before_dynamic_review_route(self):
        today = date.today()
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.manual_title = "Manual Palace Title"
            session.add_all(
                [
                    ReviewLog(
                        palace_id=palace.id,
                        review_date=today - timedelta(days=1),
                        score=4,
                        review_mode="review",
                        duration_seconds=30,
                        note="first note",
                    ),
                    ReviewLog(
                        palace_id=palace.id,
                        review_date=today,
                        score=5,
                        review_mode="review",
                        duration_seconds=40,
                        note="second note",
                    ),
                    ReviewLog(
                        palace_id=palace.id,
                        review_date=today,
                        score=5,
                        review_mode="review",
                        duration_seconds=40,
                        note="",
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/review/notes?limit=1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["note"], "second note")
        self.assertEqual(payload["items"][0]["palace_title"], "Manual Palace Title")
        self.assertEqual(payload["items"][0]["review_date"], today.isoformat())

    def test_repair_review_stage_progress_route_returns_repair_counts(self):
        with patch.object(
            review_router,
            "repair_review_stage_progress",
            return_value={"palace_count": 2, "segment_count": 0},
        ) as repair:
            response = self.client.post("/api/v1/review/repair-stage-progress")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "palace_count": 2, "segment_count": 0})
        repair.assert_called_once()

    def test_review_stage_progress_health_counts_read_only_repair_issues(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            session.add_all(
                [
                    SessionProgress(
                        session_kind="review",
                        palace_id=palace.id,
                        review_schedule_id=999999,
                        reveal_map="{}",
                        red_node_ids="[]",
                        completed=False,
                        updated_at=utc_now_naive(),
                    ),
                    StudySession(
                        id="orphan-review-session",
                        status="active",
                        scene="review",
                        target_type="review_schedule",
                        target_id=999999,
                        palace_id=palace.id,
                        title="Orphan Review",
                        started_at=utc_now_naive(),
                        progress_json="{}",
                        events_json="[]",
                        summary_json="{}",
                    ),
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=date.today() - timedelta(days=2),
                        interval_days=2,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        completed_at=utc_now_naive(),
                        review_number=2,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/review/stage-progress-health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["needs_repair"])
        self.assertEqual(payload["orphan_progress_count"], 1)
        self.assertEqual(payload["orphan_study_session_count"], 1)
        self.assertEqual(payload["stage_gap_palace_count"], 1)
        self.assertEqual(payload["total_issues"], 3)

    def test_repair_review_stage_progress_preserves_active_session_progress(self):
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            session.add(
                SessionProgress(
                    session_kind="review",
                    palace_id=schedule.palace_id,
                    review_schedule_id=schedule.id,
                    reveal_map=json.dumps({"branch-a": "revealed", "branch-b": "hidden"}),
                    red_node_ids="[]",
                    completed=False,
                    updated_at=utc_now_naive(),
                )
            )
            session.commit()

        response = self.client.post("/api/v1/review/repair-stage-progress")
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            progress = (
                session.query(SessionProgress)
                .filter_by(session_kind="review", palace_id=1)
                .first()
            )
            self.assertIsNotNone(progress)
            restored_schedule = (
                session.query(ReviewSchedule)
                .filter_by(id=progress.review_schedule_id)
                .first()
            )
            self.assertIsNotNone(restored_schedule)
            self.assertEqual(restored_schedule.review_number, 0)
            self.assertFalse(restored_schedule.completed)
            self.assertEqual(
                json.loads(progress.reveal_map),
                {"branch-a": "revealed", "branch-b": "hidden"},
            )

    def test_repair_review_stage_progress_migrates_orphan_review_progress(self):
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            session.add(
                SessionProgress(
                    session_kind="review",
                    palace_id=schedule.palace_id,
                    review_schedule_id=999999,
                    reveal_map=json.dumps({"branch-a": "revealed", "branch-b": "hidden"}),
                    red_node_ids=json.dumps(["branch-a"]),
                    completed=False,
                    updated_at=utc_now_naive(),
                )
            )
            session.commit()

        response = self.client.post("/api/v1/review/repair-stage-progress")
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            pending_schedule = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False)
                .first()
            )
            self.assertIsNotNone(pending_schedule)
            progress = (
                session.query(SessionProgress)
                .filter_by(session_kind="review", palace_id=1)
                .first()
            )
            self.assertIsNotNone(progress)
            self.assertEqual(progress.review_schedule_id, pending_schedule.id)
            self.assertEqual(
                json.loads(progress.reveal_map),
                {"branch-a": "revealed", "branch-b": "hidden"},
            )
            study_session = (
                session.query(StudySession)
                .filter_by(
                    scene="review",
                    target_type="review_schedule",
                    target_id=pending_schedule.id,
                    status="active",
                )
                .first()
            )
            self.assertIsNotNone(study_session)
            self.assertEqual(json.loads(study_session.progress_json)["reveal_map"]["branch-a"], "revealed")

    def test_review_queue_groups_multiple_due_schedules_by_palace(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            session.add(
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=date.today() - timedelta(days=1),
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["due_count"], 1)
        self.assertEqual(payload["overdue_count"], 1)
        self.assertEqual(len(payload["reviews"]), 1)
        self.assertEqual(payload["reviews"][0]["schedule_count"], 2)
        self.assertEqual(payload["reviews"][0]["overdue_schedule_count"], 2)

    def test_review_queue_auto_smoothing_skips_unstarted_overdue_palace(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="auto_smooth_overdue", value="true"),
                    Config(key="overdue_smoothing_threshold", value="1"),
                    Config(key="overdue_smoothing_days", value="7"),
                ]
            )
            original = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(original)
            original_date = original.scheduled_date
            session.commit()

        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["smoothed_count"], 0)

        with self.SessionLocal() as session:
            updated = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(updated)
            self.assertEqual(updated.scheduled_date, original_date)

    def test_review_queue_auto_smoothing_still_spreads_started_overdue_palace(self):
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            schedule.completed = True
            schedule.completed_at = datetime.now().replace(second=0, microsecond=0) - timedelta(days=2)
            session.add(
                ReviewSchedule(
                    palace_id=1,
                    scheduled_date=date.today() - timedelta(days=1),
                    scheduled_at=datetime.now().replace(second=0, microsecond=0) - timedelta(days=1),
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                )
            )
            session.add_all(
                [
                    Config(key="auto_smooth_overdue", value="true"),
                    Config(key="overdue_smoothing_threshold", value="1"),
                    Config(key="overdue_smoothing_days", value="7"),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/review/queue")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["smoothed_count"], 1)

        with self.SessionLocal() as session:
            pending = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .first()
            )
            self.assertIsNotNone(pending)
            self.assertEqual(pending.scheduled_date, date.today())

    def test_submit_review_only_advances_current_due_schedule(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            session.add_all(
                [
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=date.today() - timedelta(days=2),
                        interval_days=2,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=1,
                        review_type="standard",
                    ),
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=2,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        submit = self.client.post(
            "/api/v1/review/session/1/submit",
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        self.assertEqual(submit.status_code, 200)
        self.assertTrue(submit.json()["ok"])
        self.assertIsNone(submit.json()["next_id"])

        with self.SessionLocal() as session:
            schedules = session.query(ReviewSchedule).filter_by(palace_id=1).order_by(ReviewSchedule.id).all()
            self.assertEqual(len(schedules), 2)
            completed = [schedule for schedule in schedules if schedule.completed]
            self.assertEqual(len(completed), 1)
            self.assertEqual(completed[0].review_number, 0)
            pending = [schedule for schedule in schedules if not schedule.completed]
            self.assertEqual(len(pending), 1)
            self.assertEqual([schedule.review_number for schedule in pending], [1])

    def test_submit_review_session_persists_trimmed_note(self):
        response = self.client.post(
            "/api/v1/review/session/1/submit",
            json={
                "duration_seconds": 12,
                "completion_mode": "manual_complete",
                "note": "  瓣膜顺序卡壳  ",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

        with self.SessionLocal() as session:
            log = session.query(ReviewLog).one()
            self.assertEqual(log.note, "瓣膜顺序卡壳")

    def test_submit_review_reuses_response_for_duplicate_mutation_id(self):
        headers = {"X-Memory-Anki-Mutation-ID": "review-submit-mutation-1"}
        first = self.client.post(
            "/api/v1/review/session/1/submit",
            headers=headers,
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        second = self.client.post(
            "/api/v1/review/session/1/submit",
            headers=headers,
            json={"duration_seconds": 999, "completion_mode": "manual_complete"},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), first.json())
        with self.SessionLocal() as session:
            self.assertEqual(session.query(ReviewLog).count(), 1)
            self.assertEqual(session.query(StudySession).filter_by(scene="review").count(), 1)

    def test_submit_review_rolls_back_when_idempotency_save_fails(self):
        with self.SessionLocal() as session:
            session.add(
                SessionProgress(
                    session_kind="review",
                    palace_id=1,
                    review_schedule_id=1,
                    reveal_map=json.dumps({"branch-a": "revealed"}),
                    red_node_ids="[]",
                    completed=False,
                    updated_at=utc_now_naive(),
                )
            )
            session.commit()

        failing_client = TestClient(self.app, raise_server_exceptions=False)
        with patch.object(
            review_router.SqlAlchemyMutationResponseStore,
            "save",
            side_effect=RuntimeError("idempotency write failed"),
        ):
            response = failing_client.post(
                "/api/v1/review/session/1/submit",
                headers={"X-Memory-Anki-Mutation-ID": "review-submit-rollback"},
                json={"duration_seconds": 12, "completion_mode": "manual_complete"},
            )

        self.assertEqual(response.status_code, 500)
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            self.assertFalse(schedule.completed)
            self.assertEqual(session.query(ReviewLog).count(), 0)
            self.assertEqual(session.query(StudySession).filter_by(scene="review").count(), 0)
            self.assertIsNotNone(
                session.query(SessionProgress)
                .filter_by(session_kind="review", review_schedule_id=1)
                .first()
            )

    def test_submit_review_schedules_next_round_from_completion_time(self):
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime.now().replace(second=0, microsecond=0) - timedelta(days=3)
            session.commit()

        before = datetime.now().replace(second=0, microsecond=0)
        response = self.client.post(
            "/api/v1/review/session/1/submit",
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        after = datetime.now().replace(second=0, microsecond=0)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

        with self.SessionLocal() as session:
            next_schedule = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .first()
            )
            self.assertIsNotNone(next_schedule)
            self.assertIsNotNone(next_schedule.scheduled_at)
            self.assertGreaterEqual(next_schedule.scheduled_at, before + timedelta(days=2))
            self.assertLessEqual(next_schedule.scheduled_at, after + timedelta(days=2))
            self.assertEqual(next_schedule.scheduled_date, next_schedule.scheduled_at.date())

    def test_submit_review_rebuilds_stale_future_pending_schedule(self):
        stale_due_at = datetime.now().replace(second=0, microsecond=0) + timedelta(days=5)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime.now().replace(second=0, microsecond=0) - timedelta(days=3)
            current_schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(current_schedule)
            current_schedule.scheduled_date = date.today() - timedelta(days=1)
            current_schedule.scheduled_at = datetime.now().replace(second=0, microsecond=0) - timedelta(hours=1)
            session.add(
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=stale_due_at.date(),
                    scheduled_at=stale_due_at,
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                    anchor_date=palace.created_at.date(),
                )
            )
            session.commit()

        before = datetime.now().replace(second=0, microsecond=0)
        response = self.client.post(
            "/api/v1/review/session/1/submit",
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        after = datetime.now().replace(second=0, microsecond=0)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

        with self.SessionLocal() as session:
            pending = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .all()
            )
            self.assertEqual(len(pending), 1)
            self.assertIsNotNone(pending[0].scheduled_at)
            self.assertNotEqual(pending[0].scheduled_at, stale_due_at)
            self.assertGreaterEqual(pending[0].scheduled_at, before + timedelta(days=2))
            self.assertLessEqual(pending[0].scheduled_at, after + timedelta(days=2))

    def test_submit_review_uses_scheduled_time_as_anchor_when_enabled(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="ebbinghaus_intervals", value="1,2,4"),
                    Config(key="early_review_anchor", value="true"),
                ]
            )
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime.now().replace(second=0, microsecond=0) - timedelta(days=2)
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            due_at = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=2)
            schedule.scheduled_date = due_at.date()
            schedule.scheduled_at = due_at
            session.commit()

        with self.SessionLocal() as session:
            log, _ = submit_review(
                session,
                1,
                duration_seconds=12,
                completion_mode="manual_complete",
            )
            self.assertIsNotNone(log)

        with self.SessionLocal() as session:
            next_schedule = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .first()
            )
            self.assertIsNotNone(next_schedule)
            self.assertEqual(next_schedule.scheduled_at, due_at + timedelta(days=2))

    def test_submit_review_uses_completion_time_when_anchor_disabled(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="ebbinghaus_intervals", value="1,2,4"),
                    Config(key="early_review_anchor", value="false"),
                ]
            )
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime.now().replace(second=0, microsecond=0) - timedelta(days=2)
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            due_at = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=2)
            schedule.scheduled_date = due_at.date()
            schedule.scheduled_at = due_at
            session.commit()

        before = datetime.now().replace(second=0, microsecond=0)
        with self.SessionLocal() as session:
            log, _ = submit_review(
                session,
                1,
                duration_seconds=12,
                completion_mode="manual_complete",
            )
            self.assertIsNotNone(log)
        after = datetime.now().replace(second=0, microsecond=0)

        with self.SessionLocal() as session:
            next_schedule = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .first()
            )
            self.assertIsNotNone(next_schedule)
            self.assertIsNotNone(next_schedule.scheduled_at)
            self.assertGreaterEqual(next_schedule.scheduled_at, before + timedelta(days=2))
            self.assertLessEqual(next_schedule.scheduled_at, after + timedelta(days=2))
            self.assertNotEqual(next_schedule.scheduled_at, due_at + timedelta(days=2))

    def test_profile_review_settings_apply_to_pending_rebuilds_for_anchor_change(self):
        early_completed_at = datetime(2026, 5, 20, 8, 0)
        scheduled_due_at = datetime(2026, 5, 20, 10, 0)
        stale_pending_at = early_completed_at + timedelta(days=2)
        anchored_pending_at = scheduled_due_at + timedelta(days=2)
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="ebbinghaus_intervals", value="1,2,4"),
                    Config(key="early_review_anchor", value="false"),
                ]
            )
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime(2026, 5, 18, 10, 0)
            first_schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(first_schedule)
            first_schedule.completed = True
            first_schedule.completed_at = early_completed_at
            first_schedule.scheduled_date = scheduled_due_at.date()
            first_schedule.scheduled_at = scheduled_due_at
            session.add(
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=stale_pending_at.date(),
                    scheduled_at=stale_pending_at,
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                    anchor_date=palace.created_at.date(),
                )
            )
            session.commit()

        response = self.client.put(
            "/api/v1/settings/review",
            json={
                "early_review_anchor": "true",
                "apply_to_pending": "all",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["early_review_anchor"], "true")

        with self.SessionLocal() as session:
            pending = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .all()
            )
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0].scheduled_at, anchored_pending_at)
            self.assertNotEqual(pending[0].scheduled_at, stale_pending_at)

    def test_subject_shelf_summary_returns_triage_counts(self):
        with self.SessionLocal() as session:
            subject = Subject(name="中国近代史", color="#6366f1")
            session.add(subject)
            session.flush()

            chapter = Chapter(subject_id=subject.id, name="第一章", sort_order=0)
            session.add(chapter)
            session.flush()

            due_palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(due_palace)
            due_palace.chapters.append(chapter)
            due_palace.needs_practice = True

            later_palace = Palace(
                title="Later Shelf Palace",
                description="",
                created_at=datetime.combine(date.today(), time(hour=8)),
                updated_at=datetime.combine(date.today(), time(hour=8)),
                needs_practice=False,
            )
            practice_palace = Palace(
                title="Practice Shelf Palace",
                description="",
                created_at=datetime.combine(date.today(), time(hour=9)),
                updated_at=datetime.combine(date.today(), time(hour=9)),
                needs_practice=True,
            )
            session.add_all([later_palace, practice_palace])
            session.flush()
            later_palace.chapters.append(chapter)
            practice_palace.chapters.append(chapter)

            later_due_at = datetime.now().replace(microsecond=0) + timedelta(hours=2)
            session.add(
                ReviewSchedule(
                    palace_id=later_palace.id,
                    scheduled_date=later_due_at.date(),
                    scheduled_at=later_due_at,
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=0,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/subjects")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 1)
        item = payload["items"][0]
        self.assertEqual(item["subject"]["name"], "中国近代史")
        self.assertEqual(item["due_now_count"], 1)
        self.assertEqual(item["due_later_today_count"], 1)
        self.assertEqual(item["needs_practice_count"], 2)
        self.assertEqual(item["review_status"], "due_now")

    def test_review_session_allows_later_today_submission_and_sets_needs_practice(self):
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            self.assertIsNotNone(palace)
            schedule.scheduled_date = date.today()
            schedule.scheduled_at = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=2)
            palace.needs_practice = False
            session.commit()

        response = self.client.post(
            "/api/v1/review/session/1/submit",
            json={
                "duration_seconds": 30,
                "completion_mode": "manual_complete",
                "needs_practice": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            self.assertTrue(palace.needs_practice)

    def test_review_session_rejects_future_day_submission(self):
        with self.SessionLocal() as session:
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            schedule.scheduled_date = date.today() + timedelta(days=1)
            schedule.scheduled_at = datetime.combine(schedule.scheduled_date, time(hour=10))
            session.commit()

        response = self.client.post(
            "/api/v1/review/session/1/submit",
            json={"duration_seconds": 30, "completion_mode": "manual_complete"},
        )

        self.assertEqual(response.status_code, 404)

    def test_virtual_default_review_payload_exposes_pending_schedule_timing(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            session.add(
                PalaceSegment(
                    palace_id=palace.id,
                    name="第 2 部分",
                    color="#14b8a6",
                    node_uids_json=json.dumps(["branch-a"]),
                    sort_order=0,
                )
            )
            due_at = datetime.combine(date.today() + timedelta(days=2), time(hour=9, minute=30))
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            schedule.scheduled_date = due_at.date()
            schedule.scheduled_at = due_at
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        default_payload = item["segments"][0]
        self.assertTrue(default_payload["is_virtual_default"])
        self.assertFalse(default_payload["has_due_review"])
        self.assertEqual(default_payload["current_review_schedule_id"], 1)
        self.assertEqual(default_payload["current_review_type"], "standard")
        self.assertTrue(default_payload["next_review_at"].startswith(due_at.date().isoformat()))

    def test_review_session_routes_return_404_for_missing_schedule(self):
        response = self.client.get("/api/v1/review/session/999999")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "not found")

        submit_response = self.client.post(
            "/api/v1/review/session/999999/submit",
            json={"duration_seconds": 30, "completion_mode": "manual_complete"},
        )
        self.assertEqual(submit_response.status_code, 404)
        self.assertEqual(submit_response.json()["detail"], "not found")

    def test_review_session_includes_editor_doc(self):
        response = self.client.get("/api/v1/review/session/1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["palace"]["title"], "Test Palace")
        self.assertIn("editor_doc", payload["palace"])
        self.assertIsInstance(payload["palace"]["editor_doc"], str)
        self.assertIn("Branch A", payload["palace"]["editor_doc"])

    def test_palace_review_plan_groups_same_day_multiple_reviews(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(title="Test Palace").first()
            self.assertIsNotNone(palace)
            session.add(
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=date.today() - timedelta(days=1),
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/review-plan")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["plan"]), 1)
        self.assertEqual(payload["plan"][0]["date"], (date.today() - timedelta(days=1)).isoformat())
        self.assertEqual(payload["plan"][0]["representative_schedule_id"], 1)
        self.assertEqual(payload["plan"][0]["schedule_count"], 2)
        self.assertEqual(payload["plan"][0]["pending_count"], 2)
        self.assertEqual(payload["plan"][0]["completed_count"], 0)
        self.assertFalse(payload["plan"][0]["completed"])
        self.assertEqual(payload["plan"][0]["review_number"], 1)
        self.assertEqual(payload["plan"][0]["interval_days"], 1)

    def test_palace_review_plan_groups_completed_and_pending_same_day(self):
        with self.SessionLocal() as session:
            first_schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(first_schedule)
            first_schedule.completed = True
            session.add(
                ReviewSchedule(
                    palace_id=1,
                    scheduled_date=first_schedule.scheduled_date,
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/review-plan")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["plan"]), 1)
        self.assertEqual(payload["plan"][0]["schedule_count"], 2)
        self.assertEqual(payload["plan"][0]["pending_count"], 1)
        self.assertEqual(payload["plan"][0]["completed_count"], 1)
        self.assertFalse(payload["plan"][0]["completed"])

    def test_palace_list_includes_review_stage_progress_fields(self):
        with self.SessionLocal() as session:
            first_schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(first_schedule)
            first_schedule.completed = True
            session.add(
                ReviewLog(
                    palace_id=1,
                    review_date=date.today(),
                    score=5,
                    review_mode="review",
                    duration_seconds=60,
                )
            )
            session.add(
                ReviewSchedule(
                    palace_id=1,
                    scheduled_date=date.today() + timedelta(days=1),
                    interval_days=2,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        self.assertEqual(item["review_stage_total"], 9)
        self.assertEqual(item["review_stage_completed"], 1)
        self.assertAlmostEqual(item["review_stage_progress"], 1 / 9)

    def test_pending_review_number_two_reports_two_completed_stages(self):
        with self.SessionLocal() as session:
            session.query(ReviewSchedule).filter_by(palace_id=1).delete()
            session.add(
                ReviewSchedule(
                    palace_id=1,
                    scheduled_date=date.today() + timedelta(days=1),
                    scheduled_at=datetime.now().replace(second=0, microsecond=0) + timedelta(days=1),
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=2,
                    review_type="standard",
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        self.assertEqual(item["review_stage_completed"], 2)
        self.assertEqual(item["segments"][0]["review_stage_completed"], 2)

    def test_schedule_cleanup_collapses_legacy_future_chain(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime.combine(date.today() - timedelta(days=2), datetime.min.time())
            session.add_all(
                [
                    ReviewLog(
                        palace_id=1,
                        review_date=date.today() - timedelta(days=1),
                        score=5,
                        review_mode="review",
                        duration_seconds=90,
                    ),
                    ReviewSchedule(
                        palace_id=1,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=0,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        review_number=0,
                        review_type="1h",
                        anchor_date=date.today() - timedelta(days=2),
                    ),
                    ReviewSchedule(
                        palace_id=1,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=0,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=1,
                        review_type="sleep",
                        anchor_date=date.today() - timedelta(days=2),
                    ),
                    ReviewSchedule(
                        palace_id=1,
                        scheduled_date=date.today() + timedelta(days=2),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=4,
                        review_type="standard",
                        anchor_date=date.today() - timedelta(days=2),
                    ),
                ]
            )
            session.commit()

            changed = ensure_current_review_schedule_model(session)
            self.assertGreater(changed, 0)
            schedules = session.query(ReviewSchedule).filter_by(palace_id=1).order_by(ReviewSchedule.review_number, ReviewSchedule.id).all()

            self.assertEqual(len(schedules), 2)
            self.assertTrue(schedules[0].completed)
            self.assertEqual(schedules[0].review_number, 0)
            self.assertFalse(schedules[1].completed)
            self.assertEqual(schedules[1].review_number, 1)

    def test_palace_list_shows_mastered_palace_as_full_progress(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.mastered = True
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        self.assertEqual(item["review_stage_total"], 9)
        self.assertEqual(item["review_stage_completed"], 9)
        self.assertEqual(item["review_stage_progress"], 1.0)

    def test_practice_progress_round_trip(self):
        response = self.client.put(
            "/api/v1/practice/session/1",
            json={
                "reveal_map": {"root": "revealed", "1": "placeholder"},
                "red_node_ids": ["1"],
                "completed": False,
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["progress"]
        self.assertEqual(payload["session_kind"], "practice")
        self.assertEqual(payload["palace_id"], 1)
        self.assertEqual(payload["reveal_map"]["1"], "placeholder")

        fetched = self.client.get("/api/v1/practice/session/1")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["progress"]["red_node_ids"], ["1"])

        deleted = self.client.delete("/api/v1/practice/session/1")
        self.assertEqual(deleted.status_code, 200)
        self.assertIsNone(self.client.get("/api/v1/practice/session/1").json()["progress"])

    def test_review_progress_round_trip_and_submit_clears_it(self):
        save = self.client.put(
            "/api/v1/review/session/1/progress",
            json={
                "reveal_map": {"root": "revealed", "1": "revealed"},
                "red_node_ids": ["1"],
                "completed": False,
            },
        )
        self.assertEqual(save.status_code, 200)
        self.assertEqual(save.json()["progress"]["review_schedule_id"], 1)

        fetched = self.client.get("/api/v1/review/session/1/progress")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["progress"]["red_node_ids"], ["1"])

        submit = self.client.post(
            "/api/v1/review/session/1/submit",
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        self.assertEqual(submit.status_code, 200)
        self.assertTrue(submit.json()["ok"])

        cleared = self.client.get("/api/v1/review/session/1/progress")
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()["progress"])

    def test_review_progress_does_not_conflict_with_practice_progress_for_same_palace(self):
        practice = self.client.put(
            "/api/v1/practice/session/1",
            json={
                "reveal_map": {"root": "revealed", "1": "placeholder"},
                "red_node_ids": [],
                "completed": False,
            },
        )
        self.assertEqual(practice.status_code, 200)

        review = self.client.put(
            "/api/v1/review/session/1/progress",
            json={
                "reveal_map": {"root": "revealed", "1": "revealed"},
                "red_node_ids": ["1"],
                "completed": False,
            },
        )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["progress"]["review_schedule_id"], 1)

    def test_palace_version_detail_includes_editor_doc(self):
        versions_response = self.client.get("/api/v1/palaces/1/versions")
        self.assertEqual(versions_response.status_code, 200)
        versions = versions_response.json()["versions"]
        self.assertGreaterEqual(len(versions), 1)

        version_id = versions[0]["id"]
        response = self.client.get(f"/api/v1/palaces/1/versions/{version_id}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], version_id)
        self.assertEqual(payload["trigger_reason"], "editor_save")
        self.assertIn("editor_doc", payload)
        self.assertEqual(payload["editor_doc"]["theme"]["template"], "avocado")
        self.assertEqual(payload["editor_doc"]["root"]["children"][0]["data"]["text"], "Branch A")

    def test_palace_version_detail_rejects_wrong_version(self):
        response = self.client.get("/api/v1/palaces/1/versions/999999")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "version not found")

    def test_create_palace_version_skips_duplicate_snapshots(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            versions_before = self.client.get("/api/v1/palaces/1/versions").json()["versions"]
            create_palace_version(session, palace, "editor_save")
            session.commit()
            versions_after = self.client.get("/api/v1/palaces/1/versions").json()["versions"]

        self.assertEqual(len(versions_after), len(versions_before))

    def test_save_palace_editor_state_skips_new_snapshot_when_content_unchanged(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            before_count = session.query(PalaceVersion).filter_by(palace_id=1).count()
            payload = json.loads(palace.editor_doc)
            save_palace_editor_state(session, palace, {"editor_doc": payload, "editor_source": "palace_edit"})
            after_count = session.query(PalaceVersion).filter_by(palace_id=1).count()

        self.assertEqual(after_count, before_count)

    def test_save_palace_editor_state_throttles_editor_snapshots_within_five_minutes(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            first_version = session.query(PalaceVersion).filter_by(palace_id=1).first()
            self.assertIsNotNone(first_version)
            first_version.created_at = utc_now_naive()
            session.commit()

            editor_doc = json.loads(palace.editor_doc)
            editor_doc["root"]["children"][0]["data"]["text"] = "Changed once"
            save_palace_editor_state(session, palace, {"editor_doc": editor_doc, "editor_source": "palace_edit"})
            after_first_change = session.query(PalaceVersion).filter_by(palace_id=1).count()

            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            editor_doc = json.loads(palace.editor_doc)
            editor_doc["root"]["children"][1]["data"]["text"] = "Changed twice"
            save_palace_editor_state(session, palace, {"editor_doc": editor_doc, "editor_source": "palace_edit"})
            after_second_change = session.query(PalaceVersion).filter_by(palace_id=1).count()

        self.assertEqual(after_first_change, 1)
        self.assertEqual(after_second_change, 1)

    def test_save_palace_editor_state_creates_new_snapshot_after_five_minutes(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            first_version = session.query(PalaceVersion).filter_by(palace_id=1).first()
            self.assertIsNotNone(first_version)
            first_version.created_at = utc_now_naive() - timedelta(minutes=6)
            session.commit()

            editor_doc = json.loads(palace.editor_doc)
            editor_doc["root"]["children"][0]["data"]["text"] = "Changed after interval"
            save_palace_editor_state(session, palace, {"editor_doc": editor_doc, "editor_source": "palace_edit"})
            versions = session.query(PalaceVersion).filter_by(palace_id=1).order_by(PalaceVersion.id.desc()).all()

        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0].trigger_reason, "editor_save")
        self.assertIn("Changed after interval", versions[0].editor_doc)

    def test_create_palace_version_keeps_milestone_snapshots_even_within_interval(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            editor_version = session.query(PalaceVersion).filter_by(palace_id=1).first()
            self.assertIsNotNone(editor_version)
            editor_version.created_at = utc_now_naive()
            session.commit()

            create_palace_version(session, palace, "before-version-restore")
            session.commit()
            versions = session.query(PalaceVersion).filter_by(palace_id=1).order_by(PalaceVersion.id.desc()).all()

        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].trigger_reason, "editor_save")

    def test_listing_versions_cleans_existing_duplicate_snapshots(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            existing = session.query(PalaceVersion).filter_by(palace_id=1).first()
            self.assertIsNotNone(existing)
            duplicate = PalaceVersion(
                palace_id=existing.palace_id,
                trigger_reason=existing.trigger_reason,
                title=existing.title,
                created_at_value=existing.created_at_value,
                editor_doc=existing.editor_doc,
                editor_config=existing.editor_config,
                editor_local_config=existing.editor_local_config,
                peg_snapshot=existing.peg_snapshot,
                chapter_snapshot=existing.chapter_snapshot,
            )
            session.add(duplicate)
            session.commit()

        response = self.client.get("/api/v1/palaces/1/versions")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(payload["removed_duplicates"], 1)
        self.assertEqual(len(payload["versions"]), 1)

    def test_listing_versions_only_returns_effective_restore_points(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            base_version = session.query(PalaceVersion).filter_by(palace_id=1).first()
            self.assertIsNotNone(base_version)
            base_version.created_at = datetime(2026, 5, 8, 15, 0, 0)

            burst_one = PalaceVersion(
                palace_id=1,
                trigger_reason="editor_save",
                title=base_version.title,
                created_at_value=base_version.created_at_value,
                editor_doc=base_version.editor_doc.replace("Branch A", "Branch A v2"),
                editor_config=base_version.editor_config,
                editor_local_config=base_version.editor_local_config,
                peg_snapshot=base_version.peg_snapshot,
                chapter_snapshot=base_version.chapter_snapshot,
                created_at=datetime(2026, 5, 8, 15, 1, 0),
            )
            burst_two = PalaceVersion(
                palace_id=1,
                trigger_reason="editor_save",
                title=base_version.title,
                created_at_value=base_version.created_at_value,
                editor_doc=base_version.editor_doc.replace("Branch B", "Branch B v3"),
                editor_config=base_version.editor_config,
                editor_local_config=base_version.editor_local_config,
                peg_snapshot=base_version.peg_snapshot,
                chapter_snapshot=base_version.chapter_snapshot,
                created_at=datetime(2026, 5, 8, 15, 2, 0),
            )
            milestone = PalaceVersion(
                palace_id=1,
                trigger_reason="before-version-restore",
                title=base_version.title,
                created_at_value=base_version.created_at_value,
                editor_doc=base_version.editor_doc.replace("Branch B", "Milestone"),
                editor_config=base_version.editor_config,
                editor_local_config=base_version.editor_local_config,
                peg_snapshot=base_version.peg_snapshot,
                chapter_snapshot=base_version.chapter_snapshot,
                created_at=datetime(2026, 5, 8, 15, 2, 30),
            )
            later_editor = PalaceVersion(
                palace_id=1,
                trigger_reason="editor_save",
                title=base_version.title,
                created_at_value=base_version.created_at_value,
                editor_doc=base_version.editor_doc.replace("Branch B", "Branch B v4"),
                editor_config=base_version.editor_config,
                editor_local_config=base_version.editor_local_config,
                peg_snapshot=base_version.peg_snapshot,
                chapter_snapshot=base_version.chapter_snapshot,
                created_at=datetime(2026, 5, 8, 15, 8, 0),
            )
            session.add_all([burst_one, burst_two, milestone, later_editor])
            session.commit()

        response = self.client.get("/api/v1/palaces/1/versions")
        self.assertEqual(response.status_code, 200)
        versions = response.json()["versions"]
        self.assertEqual([item["trigger_reason"] for item in versions], ["editor_save", "before-version-restore", "editor_save"])

    def test_interval_backup_skips_when_recent_backup_exists(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            from memory_anki.modules.backups.application import backup_lifecycle

            original_full_dir = backup_lifecycle.FULL_BACKUPS_DIR
            backup_root = Path(temp_dir)
            backup_lifecycle.FULL_BACKUPS_DIR = backup_root
            backup_root.mkdir(parents=True, exist_ok=True)
            recent = backup_root / "20260509-000000-rolling-edit"
            recent.mkdir()
            (recent / "memory_palace.db").write_text("db", encoding="utf-8")

            try:
                created = maybe_create_interval_backup("rolling-edit", ROLLING_EDIT_BACKUP_INTERVAL)
            finally:
                backup_lifecycle.FULL_BACKUPS_DIR = original_full_dir

        self.assertIsNone(created)

    def test_save_palace_editor_rejects_practice_edit_structure_drop(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A"}, "children": [{"data": {"text": "Leaf A1"}, "children": []}]},
                            {"data": {"text": "Branch B"}, "children": []},
                        ],
                    }
                }
            )
            session.commit()

        response = self.client.put(
            "/api/v1/palaces/1/editor",
            json={
                "editor_source": "practice_edit",
                "editor_doc": {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A"}, "children": []},
                        ],
                    }
                },
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("已拒绝写回宫殿", response.json()["detail"])

    def test_save_palace_editor_allows_confirmed_dangerous_change_from_palace_edit(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A"}, "children": [{"data": {"text": "Leaf A1"}, "children": []}]},
                            {"data": {"text": "Branch B"}, "children": []},
                        ],
                    }
                }
            )
            session.commit()

        response = self.client.put(
            "/api/v1/palaces/1/editor",
            json={
                "editor_source": "palace_edit",
                "confirm_dangerous_change": True,
                "editor_doc": {
                    "root": {
                        "data": {"text": "导入脑图"},
                        "children": [
                            {"data": {"text": "新增节点"}, "children": []},
                        ],
                    }
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["editor_doc"]["root"]["data"]["text"], "Test Palace")
        self.assertEqual(len(payload["editor_doc"]["root"]["children"]), 1)
        saved_child = payload["editor_doc"]["root"]["children"][0]["data"]
        self.assertEqual(saved_child["text"], "新增节点")
        self.assertEqual(saved_child["memoryAnkiNodeType"], "peg")
        self.assertIsInstance(saved_child["memoryAnkiId"], int)

    def test_save_palace_editor_rejects_stale_expected_fingerprint(self):
        initial = self.client.get("/api/v1/palaces/1/editor")
        self.assertEqual(initial.status_code, 200)
        stale_fingerprint = initial.json()["editor_fingerprint"]
        self.assertTrue(stale_fingerprint)

        server_update = self.client.put(
            "/api/v1/palaces/1/editor",
            json={
                "editor_source": "palace_edit",
                "editor_doc": {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Server A", "uid": "server-a"}, "children": []},
                            {"data": {"text": "Server B", "uid": "server-b"}, "children": []},
                        ],
                    }
                },
            },
        )
        self.assertEqual(server_update.status_code, 200)

        stale_save = self.client.put(
            "/api/v1/palaces/1/editor",
            json={
                "editor_source": "palace_edit_autosave",
                "expected_editor_fingerprint": stale_fingerprint,
                "editor_doc": {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Local A", "uid": "local-a"}, "children": []},
                            {"data": {"text": "Local B", "uid": "local-b"}, "children": []},
                        ],
                    }
                },
            },
        )

        self.assertEqual(stale_save.status_code, 409)
        self.assertIn("脑图保存冲突", stale_save.json()["detail"]["message"])

    def test_get_palace_editor_repairs_saved_review_overlay_doc(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            branch_a = Peg(palace_id=palace.id, name="Branch A", content="Detail A", sort_order=0)
            branch_b = Peg(palace_id=palace.id, name="Branch B", content="", sort_order=1)
            session.add_all([branch_a, branch_b])
            session.flush()
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {
                            "text": "Test Palace",
                            "memoryAnkiRootKind": "palace",
                            "fillColor": "#111827",
                            "borderColor": "#0f172a",
                            "borderWidth": 2,
                            "color": "#f8fafc",
                            "fontWeight": "bold",
                        },
                        "children": [
                            {
                                "data": {
                                    "text": "<p>待回忆</p>",
                                    "note": "",
                                    "uid": "branch-a",
                                    "memoryAnkiId": branch_a.id,
                                    "memoryAnkiNodeType": "peg",
                                    "fillColor": "#eef2f7",
                                    "borderColor": "#94a3b8",
                                    "borderWidth": 2,
                                    "color": "#475569",
                                    "lineColor": "#22c55e",
                                    "lineWidth": 3,
                                    "hideNote": True,
                                    "customTextWidth": 132,
                                },
                                "children": [],
                            },
                            {
                                "data": {
                                    "text": "<p>Branch B</p>",
                                    "uid": "branch-b",
                                    "memoryAnkiId": branch_b.id,
                                    "memoryAnkiNodeType": "peg",
                                    "fillColor": "#ecfdf5",
                                    "borderColor": "#22c55e",
                                    "borderWidth": 2,
                                    "color": "#14532d",
                                    "lineColor": "#22c55e",
                                    "lineWidth": 3,
                                },
                                "children": [],
                            },
                        ],
                    }
                },
                ensure_ascii=False,
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/editor")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        repaired_root = payload["editor_doc"]["root"]
        repaired_a = repaired_root["children"][0]["data"]
        repaired_b = repaired_root["children"][1]["data"]
        self.assertEqual(repaired_a["text"], "Branch A")
        self.assertEqual(repaired_a["note"], "Detail A")
        self.assertNotIn("hideNote", repaired_a)
        self.assertNotIn("customTextWidth", repaired_a)
        self.assertNotIn("fillColor", repaired_a)
        self.assertNotIn("fillColor", repaired_b)
        self.assertNotIn("fillColor", repaired_root["data"])

    def test_save_palace_editor_state_sanitizes_review_overlay_before_persisting(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            branch_a = Peg(palace_id=palace.id, name="Branch A", content="Detail A", sort_order=0)
            branch_b = Peg(palace_id=palace.id, name="Branch B", content="", sort_order=1)
            session.add_all([branch_a, branch_b])
            session.flush()
            state = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_source": "palace_edit",
                    "editor_doc": {
                        "root": {
                            "data": {
                                "text": "Test Palace",
                                "memoryAnkiRootKind": "palace",
                                "fillColor": "#111827",
                                "borderColor": "#0f172a",
                                "borderWidth": 2,
                                "color": "#f8fafc",
                                "fontWeight": "bold",
                            },
                            "children": [
                                {
                                    "data": {
                                        "text": "<p>待回忆</p>",
                                        "note": "",
                                        "uid": "branch-a",
                                        "memoryAnkiId": branch_a.id,
                                        "memoryAnkiNodeType": "peg",
                                        "fillColor": "#eef2f7",
                                        "borderColor": "#94a3b8",
                                        "borderWidth": 2,
                                        "color": "#475569",
                                        "lineColor": "#22c55e",
                                        "lineWidth": 3,
                                        "hideNote": True,
                                        "customTextWidth": 132,
                                    },
                                    "children": [],
                                },
                                {
                                    "data": {
                                        "text": "<p>Branch B</p>",
                                        "uid": "branch-b",
                                        "memoryAnkiId": branch_b.id,
                                        "memoryAnkiNodeType": "peg",
                                        "fillColor": "#ecfdf5",
                                        "borderColor": "#22c55e",
                                        "borderWidth": 2,
                                        "color": "#14532d",
                                        "lineColor": "#22c55e",
                                        "lineWidth": 3,
                                    },
                                    "children": [],
                                },
                            ],
                        }
                    },
                },
            )
            stored_doc = json.loads(palace.editor_doc)

        repaired_a = state["editor_doc"]["root"]["children"][0]["data"]
        self.assertEqual(repaired_a["text"], "Branch A")
        self.assertEqual(repaired_a["note"], "Detail A")
        self.assertNotIn("fillColor", repaired_a)
        self.assertNotIn("hideNote", repaired_a)
        self.assertEqual(stored_doc["root"]["children"][0]["data"]["text"], "Branch A")
        self.assertEqual(stored_doc["root"]["children"][0]["data"]["note"], "Detail A")
        self.assertNotIn("fillColor", stored_doc["root"]["children"][0]["data"])

    def test_get_palace_editor_recovers_placeholder_nodes_from_latest_clean_version(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            branch_a = Peg(palace_id=palace.id, name="Branch A", content="Detail A", sort_order=0)
            branch_b = Peg(palace_id=palace.id, name="Branch B", content="Detail B", sort_order=1)
            session.add_all([branch_a, branch_b])
            session.flush()
            session.add(
                PalaceVersion(
                    palace_id=palace.id,
                    trigger_reason="editor_save",
                    title=palace.title,
                    created_at_value=palace.created_at,
                    editor_doc=json.dumps(
                        {
                            "root": {
                                "data": {"text": "Test Palace", "memoryAnkiRootKind": "palace"},
                                "children": [
                                    {
                                        "data": {
                                            "text": "<p>Branch A</p>",
                                            "note": "Detail A",
                                            "memoryAnkiId": branch_a.id,
                                            "memoryAnkiNodeType": "peg",
                                        },
                                        "children": [],
                                    },
                                    {
                                        "data": {
                                            "text": "<p>Branch B</p>",
                                            "note": "Detail B",
                                            "memoryAnkiId": branch_b.id,
                                            "memoryAnkiNodeType": "peg",
                                        },
                                        "children": [],
                                    },
                                ],
                            }
                        },
                        ensure_ascii=False,
                    ),
                    editor_config="{}",
                    editor_local_config=json.dumps({"__lang": "zh"}, ensure_ascii=False),
                    peg_snapshot="[]",
                    chapter_snapshot="[]",
                )
            )
            branch_a.name = "待回忆"
            branch_a.content = ""
            branch_b.name = "待回忆"
            branch_b.content = ""
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {
                            "text": "Test Palace",
                            "memoryAnkiRootKind": "palace",
                            "fillColor": "#111827",
                            "borderColor": "#0f172a",
                            "borderWidth": 2,
                            "color": "#f8fafc",
                            "fontWeight": "bold",
                        },
                        "children": [
                            {
                                "data": {
                                    "text": "<p>待回忆</p>",
                                    "note": "",
                                    "memoryAnkiId": branch_a.id,
                                    "memoryAnkiNodeType": "peg",
                                    "fillColor": "#eef2f7",
                                    "borderColor": "#94a3b8",
                                    "borderWidth": 2,
                                    "color": "#475569",
                                    "lineColor": "#22c55e",
                                    "lineWidth": 3,
                                    "hideNote": True,
                                    "customTextWidth": 132,
                                },
                                "children": [],
                            },
                            {
                                "data": {
                                    "text": "<p>待回忆</p>",
                                    "note": "",
                                    "memoryAnkiId": branch_b.id,
                                    "memoryAnkiNodeType": "peg",
                                    "fillColor": "#eef2f7",
                                    "borderColor": "#94a3b8",
                                    "borderWidth": 2,
                                    "color": "#475569",
                                    "lineColor": "#22c55e",
                                    "lineWidth": 3,
                                    "hideNote": True,
                                    "customTextWidth": 132,
                                },
                                "children": [],
                            },
                        ],
                    }
                },
                ensure_ascii=False,
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/editor")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        repaired_children = payload["editor_doc"]["root"]["children"]
        self.assertEqual(repaired_children[0]["data"]["text"], "<p>Branch A</p>")
        self.assertEqual(repaired_children[0]["data"]["note"], "Detail A")
        self.assertEqual(repaired_children[1]["data"]["text"], "<p>Branch B</p>")
        self.assertEqual(repaired_children[1]["data"]["note"], "Detail B")

    def test_ai_split_editor_endpoint_returns_transformed_editor_doc(self):
        mocked_doc = {
            "root": {
                "data": {"text": "Test Palace", "memoryAnkiRootKind": "palace"},
                "children": [
                    {
                        "data": {"text": "AI分类", "uid": "split-1"},
                        "children": [],
                    }
                ],
            }
        }

        with patch(
            "memory_anki.modules.palaces.presentation.editor_router.split_palace_editor_doc_with_ai",
            return_value=SimpleNamespace(
                editor_doc=mocked_doc,
                generated_children_count=1,
                reassigned_existing_children_count=2,
                model="qwen3.6-flash",
            ),
        ) as mock_split:
            response = self.client.post(
                "/api/v1/palaces/1/editor/ai-split",
                json={
                    "editor_doc": {
                        "root": {
                            "data": {"text": "Test Palace", "memoryAnkiRootKind": "palace"},
                            "children": [],
                        }
                    },
                    "target_node_uid": None,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["editor_doc"], mocked_doc)
        self.assertEqual(payload["generated_children_count"], 1)
        self.assertEqual(payload["reassigned_existing_children_count"], 2)
        self.assertEqual(payload["model"], "qwen3.6-flash")
        mock_split.assert_called_once()

    def test_restore_palace_from_backup_restores_full_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_db_path = Path(temp_dir) / "backup.db"
            backup_engine = create_engine(f"sqlite:///{backup_db_path}")
            Base.metadata.create_all(backup_engine)
            BackupSession = sessionmaker(bind=backup_engine)
            with BackupSession() as backup_session:
                backup_palace = Palace(
                    id=1,
                    title="Recovered Palace",
                    description="Recovered Description",
                    difficulty=0,
                    review_mode="review",
                    created_at=None,
                    editor_doc=json.dumps(
                        {
                            "root": {
                                "data": {"text": "Recovered Palace", "memoryAnkiRootKind": "palace"},
                                "children": [
                                    {"data": {"text": "A", "memoryAnkiId": 10}, "children": []},
                                    {"data": {"text": "B", "memoryAnkiId": 11}, "children": []},
                                    {"data": {"text": "C", "memoryAnkiId": 12}, "children": []},
                                ],
                            }
                        },
                        ensure_ascii=False,
                    ),
                    editor_config=json.dumps({"theme": {"template": "avocado"}}),
                    editor_local_config=json.dumps({"__lang": "zh"}),
                )
                backup_session.add(backup_palace)
                backup_session.commit()
            backup_engine.dispose()

            with self.SessionLocal() as session:
                palace = session.query(Palace).filter_by(id=1).first()
                self.assertIsNotNone(palace)
                palace.editor_doc = json.dumps(
                    {
                        "root": {
                            "data": {"text": "Test Palace"},
                            "children": [{"data": {"text": "Only One"}, "children": []}],
                        }
                    }
                )
                session.commit()

            with self.SessionLocal() as session:
                restored = restore_palace_from_backup(session, backup_db_path=str(backup_db_path), palace_id=1)
                self.assertEqual(restored["restored_title"], "Recovered Palace")
                self.assertEqual(restored["restored_node_count"], 4)
                self.assertTrue(restored["rescue_snapshot_path"])

            palace_response = self.client.get("/api/v1/palaces/1/editor")
            self.assertEqual(palace_response.status_code, 200)
            payload = palace_response.json()
            self.assertEqual(payload["palace"]["title"], "Recovered Palace")
            self.assertEqual(len(payload["editor_doc"]["root"]["children"]), 3)

    def test_export_palace_snapshot_comparison_summarizes_current_and_backup_differences(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_db_path = Path(temp_dir) / "backup.db"
            backup_engine = create_engine(f"sqlite:///{backup_db_path}")
            Base.metadata.create_all(backup_engine)
            BackupSession = sessionmaker(bind=backup_engine)
            with BackupSession() as backup_session:
                backup_palace = Palace(
                    id=1,
                    title="Recovered Palace",
                    description="Recovered Description",
                    difficulty=0,
                    review_mode="review",
                    created_at=None,
                    editor_doc=json.dumps(
                        {
                            "root": {
                                "data": {"text": "Recovered Palace", "memoryAnkiRootKind": "palace"},
                                "children": [
                                    {"data": {"text": "A", "memoryAnkiId": 10}, "children": []},
                                    {"data": {"text": "B", "memoryAnkiId": 11}, "children": []},
                                    {"data": {"text": "C", "memoryAnkiId": 12}, "children": []},
                                ],
                            }
                        },
                        ensure_ascii=False,
                    ),
                    editor_config=json.dumps({"theme": {"template": "avocado"}}),
                    editor_local_config=json.dumps({"__lang": "zh"}),
                )
                backup_session.add(backup_palace)
                backup_session.commit()
            backup_engine.dispose()

            with self.SessionLocal() as session:
                palace = session.query(Palace).filter_by(id=1).first()
                self.assertIsNotNone(palace)
                palace.editor_doc = json.dumps(
                    {
                        "root": {
                            "data": {"text": "Test Palace"},
                            "children": [
                                {"data": {"text": "A"}, "children": []},
                                {"data": {"text": "Only One"}, "children": []},
                            ],
                        }
                    }
                )
                session.commit()

                comparison = export_palace_snapshot_comparison(
                    session,
                    palace_id=1,
                    backup_db_path=str(backup_db_path),
                )

            self.assertEqual(comparison["palace_id"], 1)
            self.assertEqual(len(comparison["snapshots"]), 2)
            current_snapshot = next(item for item in comparison["snapshots"] if item["source_kind"] == "current_db")
            backup_snapshot = next(item for item in comparison["snapshots"] if item["source_kind"] == "backup_db")
            self.assertEqual(current_snapshot["node_count"], 2)
            self.assertEqual(backup_snapshot["node_count"], 3)
            current_vs_backup = next(
                item for item in comparison["comparisons"] if item["compare_key"] == "current_vs_backup"
            )
            self.assertEqual(current_vs_backup["node_count_delta"], -1)
            self.assertIn("B", current_vs_backup["missing_top_level_texts"])
            self.assertIn("C", current_vs_backup["missing_top_level_texts"])

if __name__ == "__main__":
    unittest.main()
