import json
import tempfile
import unittest
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import memory_anki.app.main as main_module
from memory_anki.infrastructure.db.models import Base, Config, Palace, PalaceSegment, PalaceSegmentReviewSchedule, PalaceVersion, ReviewLog, ReviewSchedule, TimeRecord
from memory_anki.modules.backups.application.backup_service import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    create_palace_version,
    maybe_create_interval_backup,
    restore_palace_from_backup,
)
from memory_anki.modules.mindmap.application.editor_state_service import save_palace_editor_state
from memory_anki.modules.reviews.application.review_service import submit_review, submit_segment_review
from memory_anki.modules.reviews.application.schedule_service import ensure_current_review_schedule_model
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.sessions.application.session_progress_service import (
    ensure_session_progress_schema,
)
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.modules.time_records.presentation import router as time_records_router
from memory_anki.modules.time_records.application.time_records_service import (
    create_review_time_record,
    ensure_review_log_time_records,
    get_today_formal_review_duration_seconds,
    get_today_total_review_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
    normalize_time_record_event_timezones,
)


def utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ReviewRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        ensure_session_progress_schema()
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = review_router.get_session
        self.original_palace_get_session = palace_router.get_session
        self.original_settings_get_session = settings_router.get_session
        self.original_time_records_get_session = time_records_router.get_session

        def get_test_session():
            return self.SessionLocal()

        review_router.get_session = get_test_session
        palace_router.get_session = get_test_session
        settings_router.get_session = get_test_session
        time_records_router.get_session = get_test_session

        with self.SessionLocal() as session:
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

        app = FastAPI()
        app.include_router(review_router.router, prefix="/api/v1")
        app.include_router(palace_router.router, prefix="/api/v1")
        app.include_router(settings_router.router, prefix="/api/v1")
        app.include_router(time_records_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        review_router.get_session = self.original_get_session
        palace_router.get_session = self.original_palace_get_session
        settings_router.get_session = self.original_settings_get_session
        time_records_router.get_session = self.original_time_records_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_overdue_count_route_is_not_captured_by_schedule_id(self):
        response = self.client.get("/api/v1/review/overdue-count")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)

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

    def test_submit_review_creates_review_time_record(self):
        with self.SessionLocal() as session:
            log, _ = submit_review(
                session,
                1,
                duration_seconds=120,
                completion_mode="manual_complete",
            )
            self.assertIsNotNone(log)
            records = session.query(TimeRecord).filter_by(kind="review").all()
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].id, f"review-log-{log.id}")
            self.assertEqual(records[0].effective_seconds, 120)
            self.assertEqual(records[0].title, "Test Palace")

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

    def test_submit_segment_review_schedules_next_round_from_completion_time(self):
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["branch-a"]),
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            session.add(
                PalaceSegmentReviewSchedule(
                    palace_segment_id=segment.id,
                    scheduled_date=date.today() - timedelta(days=1),
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=0,
                    review_type="standard",
                )
            )
            session.commit()

        before = datetime.now().replace(second=0, microsecond=0)
        with self.SessionLocal() as session:
            submitted, _ = submit_segment_review(
                session,
                1,
                duration_seconds=30,
                completion_mode="manual_complete",
            )
        after = datetime.now().replace(second=0, microsecond=0)
        self.assertIsNotNone(submitted)

        with self.SessionLocal() as session:
            next_schedule = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=1, completed=False, review_number=1)
                .first()
            )
            self.assertIsNotNone(next_schedule)
            self.assertIsNotNone(next_schedule.scheduled_at)
            self.assertGreaterEqual(next_schedule.scheduled_at, before + timedelta(days=2))
            self.assertLessEqual(next_schedule.scheduled_at, after + timedelta(days=2))
            self.assertEqual(next_schedule.scheduled_date, next_schedule.scheduled_at.date())
            completed_schedule = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=1, completed=True, review_number=0)
                .first()
            )
            self.assertIsNotNone(completed_schedule)
            self.assertIsNotNone(completed_schedule.completed_at)
            self.assertGreaterEqual(completed_schedule.completed_at, before)
            self.assertLessEqual(completed_schedule.completed_at, after)

    def test_submit_segment_review_rebuilds_stale_future_pending_schedule(self):
        stale_due_at = datetime.now().replace(second=0, microsecond=0) + timedelta(days=5)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["branch-a"]),
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            schedule = PalaceSegmentReviewSchedule(
                palace_segment_id=segment.id,
                scheduled_date=date.today() - timedelta(days=1),
                scheduled_at=datetime.now().replace(second=0, microsecond=0) - timedelta(hours=1),
                interval_days=1,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=0,
                review_type="standard",
                anchor_date=date.today() - timedelta(days=2),
            )
            stale_schedule = PalaceSegmentReviewSchedule(
                palace_segment_id=segment.id,
                scheduled_date=stale_due_at.date(),
                scheduled_at=stale_due_at,
                interval_days=2,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=1,
                review_type="standard",
                anchor_date=date.today() - timedelta(days=2),
            )
            session.add_all([schedule, stale_schedule])
            session.commit()
            schedule_id = schedule.id

        before = datetime.now().replace(second=0, microsecond=0)
        with self.SessionLocal() as session:
            submitted, _ = submit_segment_review(
                session,
                schedule_id,
                duration_seconds=30,
                completion_mode="manual_complete",
            )
            self.assertIsNotNone(submitted)
        after = datetime.now().replace(second=0, microsecond=0)

        with self.SessionLocal() as session:
            pending = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=1, completed=False, review_number=1)
                .all()
            )
            self.assertEqual(len(pending), 1)
            self.assertIsNotNone(pending[0].scheduled_at)
            self.assertNotEqual(pending[0].scheduled_at, stale_due_at)
            self.assertGreaterEqual(pending[0].scheduled_at, before + timedelta(days=2))
            self.assertLessEqual(pending[0].scheduled_at, after + timedelta(days=2))

    def test_adjust_segment_review_progress_advances_and_reschedules_next_round(self):
        completed_at = datetime(2026, 5, 10, 10, 30)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["branch-a"]),
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            segment_id = segment.id
            session.add(
                PalaceSegmentReviewSchedule(
                    palace_segment_id=segment.id,
                    scheduled_date=date.today() - timedelta(days=1),
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=0,
                    review_type="standard",
                    anchor_date=date.today() - timedelta(days=1),
                )
            )
            session.commit()

        response = self.client.put(
            f"/api/v1/palace-segments/{segment_id}/review-progress",
            json={"completed_count": 2, "completed_at": completed_at.isoformat(timespec="minutes")},
        )
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            schedules = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=segment_id)
                .order_by(PalaceSegmentReviewSchedule.review_number)
                .all()
            )
            self.assertEqual([schedule.review_number for schedule in schedules], [0, 1, 2])
            self.assertEqual([schedule.completed for schedule in schedules], [True, True, False])
            self.assertEqual(schedules[0].completed_at, completed_at)
            self.assertEqual(schedules[1].completed_at, completed_at)
            self.assertEqual(schedules[2].scheduled_at, completed_at + timedelta(days=4))
            self.assertEqual(schedules[2].scheduled_date, (completed_at + timedelta(days=4)).date())

    def test_adjust_segment_review_progress_rolls_back_to_previous_node(self):
        completed_at = datetime(2026, 5, 10, 10, 30)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["branch-a"]),
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            segment_id = segment.id
            session.add_all(
                [
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=completed_at.date(),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        completed_at=completed_at,
                        review_number=0,
                        review_type="standard",
                        anchor_date=completed_at.date(),
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=completed_at.date(),
                        interval_days=2,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        completed_at=completed_at + timedelta(days=2),
                        review_number=1,
                        review_type="standard",
                        anchor_date=completed_at.date(),
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=(completed_at + timedelta(days=6)).date(),
                        scheduled_at=completed_at + timedelta(days=6),
                        interval_days=4,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=2,
                        review_type="standard",
                        anchor_date=completed_at.date(),
                    ),
                ]
            )
            session.commit()

        response = self.client.put(
            f"/api/v1/palace-segments/{segment_id}/review-progress",
            json={"completed_count": 1},
        )
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            schedules = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=segment_id)
                .order_by(PalaceSegmentReviewSchedule.review_number)
                .all()
            )
            self.assertEqual([schedule.review_number for schedule in schedules], [0, 1])
            self.assertEqual([schedule.completed for schedule in schedules], [True, False])
            self.assertEqual(schedules[0].completed_at, completed_at)
            self.assertEqual(schedules[1].scheduled_at, completed_at + timedelta(days=2))

    def test_adjust_segment_review_progress_updates_completed_time(self):
        old_completed_at = datetime(2026, 5, 10, 10, 30)
        new_completed_at = datetime(2026, 5, 11, 9, 15)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["branch-a"]),
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            segment_id = segment.id
            session.add_all(
                [
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=old_completed_at.date(),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=True,
                        completed_at=old_completed_at,
                        review_number=0,
                        review_type="standard",
                        anchor_date=old_completed_at.date(),
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=(old_completed_at + timedelta(days=2)).date(),
                        scheduled_at=old_completed_at + timedelta(days=2),
                        interval_days=2,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=1,
                        review_type="standard",
                        anchor_date=old_completed_at.date(),
                    ),
                ]
            )
            session.commit()

        response = self.client.put(
            f"/api/v1/palace-segments/{segment_id}/review-progress",
            json={
                "completed_count": 1,
                "completed_review_number": 0,
                "completed_at": new_completed_at.isoformat(timespec="minutes"),
            },
        )
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            schedules = (
                session.query(PalaceSegmentReviewSchedule)
                .filter_by(palace_segment_id=segment_id)
                .order_by(PalaceSegmentReviewSchedule.review_number)
                .all()
            )
            self.assertEqual(schedules[0].completed_at, new_completed_at)
            self.assertEqual(schedules[1].scheduled_at, new_completed_at + timedelta(days=2))

    def test_default_segment_review_progress_rebuilds_stale_future_pending_schedule(self):
        stale_due_at = datetime(2026, 5, 29, 10, 0)
        completed_at = datetime(2026, 5, 24, 10, 0)
        with self.SessionLocal() as session:
            session.add(Config(key="ebbinghaus_intervals", value="1,2,4"))
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.created_at = datetime(2026, 5, 20, 10, 0)
            first_schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(first_schedule)
            first_schedule.completed = True
            first_schedule.completed_at = datetime(2026, 5, 20, 10, 0)
            first_schedule.scheduled_date = first_schedule.completed_at.date()
            first_schedule.scheduled_at = first_schedule.completed_at
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

        response = self.client.put(
            "/api/v1/palaces/1/default-segment/review-progress",
            json={
                "completed_count": 1,
                "completed_review_number": 0,
                "completed_at": completed_at.isoformat(timespec="minutes"),
            },
        )
        self.assertEqual(response.status_code, 200)

        with self.SessionLocal() as session:
            pending = (
                session.query(ReviewSchedule)
                .filter_by(palace_id=1, completed=False, review_number=1)
                .all()
            )
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0].scheduled_at, completed_at + timedelta(days=2))
            self.assertNotEqual(pending[0].scheduled_at, stale_due_at)

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
            "/api/v1/profile/review-settings",
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

    def test_ensure_review_log_time_records_backfills_once(self):
        with self.SessionLocal() as session:
            review_log = ReviewLog(
                palace_id=1,
                review_date=date.today() - timedelta(days=1),
                score=5,
                review_mode="review",
                duration_seconds=300,
            )
            session.add(review_log)
            session.commit()
            session.refresh(review_log)

            created_first = ensure_review_log_time_records(session)
            created_second = ensure_review_log_time_records(session)
            migrated = session.query(TimeRecord).filter_by(id=f"review-log-{review_log.id}").first()

            self.assertEqual(created_first, 1)
            self.assertEqual(created_second, 0)
            self.assertIsNotNone(migrated)
            self.assertEqual(migrated.kind, "review")
            self.assertEqual(migrated.effective_seconds, 300)

    def test_dashboard_duration_helpers_only_use_time_records(self):
        with self.SessionLocal() as session:
            session.add(Config(key="time_recording_threshold_seconds", value="120"))
            session.add(
                ReviewLog(
                    palace_id=1,
                    review_date=date.today(),
                    score=5,
                    review_mode="review",
                    duration_seconds=999,
                )
            )
            now = datetime.now().replace(microsecond=0)
            session.add_all(
                [
                    TimeRecord(
                        id="review-now",
                        kind="review",
                        palace_id=1,
                        title="Test Palace",
                        started_at=now - timedelta(seconds=120),
                        ended_at=now,
                        effective_seconds=120,
                        pause_count=0,
                        completion_method="manual_complete",
                        duration_edited=False,
                        events_json="[]",
                    ),
                    TimeRecord(
                        id="practice-now",
                        kind="practice",
                        palace_id=1,
                        title="Test Palace",
                        started_at=now - timedelta(seconds=180),
                        ended_at=now,
                        effective_seconds=180,
                        pause_count=0,
                        completion_method="manual_complete",
                        duration_edited=False,
                        events_json="[]",
                    ),
                    TimeRecord(
                        id="edit-now",
                        kind="palace_edit",
                        palace_id=1,
                        title="Test Palace",
                        started_at=now - timedelta(seconds=60),
                        ended_at=now,
                        effective_seconds=60,
                        pause_count=0,
                        completion_method="saved",
                        duration_edited=False,
                        events_json="[]",
                    ),
                ]
            )
            session.commit()

            self.assertEqual(get_today_formal_review_duration_seconds(session), 0)
            self.assertEqual(get_weekly_formal_review_duration_seconds(session), 0)
            self.assertEqual(get_today_total_review_duration_seconds(session), 180)
            self.assertEqual(get_weekly_total_review_duration_seconds(session), 180)

    def test_dashboard_returns_today_learning_and_today_new_palaces(self):
        original_main_get_session = main_module.get_session

        def get_test_session():
            return self.SessionLocal()

        main_module.get_session = get_test_session
        dashboard_client = TestClient(main_module.app)
        try:
            with self.SessionLocal() as session:
                palace = session.query(Palace).filter_by(id=1).first()
                self.assertIsNotNone(palace)
                palace.created_at = datetime.combine(date.today(), time(hour=9))
                palace.updated_at = palace.created_at

                second_palace = Palace(
                    title="Ungrouped Palace",
                    description="",
                    created_at=datetime.combine(date.today(), time(hour=10)),
                    updated_at=datetime.combine(date.today(), time(hour=10)),
                )
                session.add(second_palace)
                session.flush()

                now = datetime.now().replace(microsecond=0)
                session.add_all(
                    [
                        TimeRecord(
                            id="review-dashboard",
                            kind="review",
                            palace_id=palace.id,
                            title="Test Palace",
                            started_at=now - timedelta(seconds=360),
                            ended_at=now,
                            effective_seconds=360,
                            pause_count=0,
                            completion_method="manual_complete",
                            duration_edited=False,
                            events_json="[]",
                        ),
                        TimeRecord(
                            id="practice-dashboard",
                            kind="practice",
                            palace_id=palace.id,
                            title="Test Palace",
                            started_at=now - timedelta(seconds=180),
                            ended_at=now,
                            effective_seconds=180,
                            pause_count=0,
                            completion_method="manual_complete",
                            duration_edited=False,
                            events_json="[]",
                        ),
                        TimeRecord(
                            id="edit-dashboard",
                            kind="palace_edit",
                            palace_id=second_palace.id,
                            title="Ungrouped Palace",
                            started_at=now - timedelta(seconds=240),
                            ended_at=now,
                            effective_seconds=240,
                            pause_count=0,
                            completion_method="saved",
                            duration_edited=False,
                            events_json="[]",
                        ),
                    ]
                )
                session.commit()

            response = dashboard_client.get("/api/v1/dashboard")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["today_new_palace_count"], 2)
            self.assertEqual(len(payload["today_learning_palaces"]), 2)
            self.assertEqual(payload["today_learning_palaces"][0]["palace_title"], "Test Palace")
            self.assertEqual(payload["today_learning_palaces"][0]["total_seconds"], 540)
            self.assertEqual(payload["today_learning_palaces"][0]["review_seconds"], 360)
            self.assertEqual(payload["today_learning_palaces"][0]["practice_seconds"], 180)
            self.assertEqual(payload["today_learning_palaces"][0]["palace_edit_seconds"], 0)
            self.assertTrue(any(subject["ungrouped_palaces"] for subject in payload["today_new_palaces"]))
        finally:
            main_module.get_session = original_main_get_session

    def test_create_review_time_record_respects_threshold(self):
        with self.SessionLocal() as session:
            session.add(Config(key="time_recording_threshold_seconds", value="120"))
            session.commit()

            created = create_review_time_record(
                session,
                record_id="threshold-review",
                palace_id=1,
                palace_segment_id=None,
                title="Test Palace",
                duration_seconds=80,
                ended_at=datetime.now(),
                completion_method="manual_complete",
            )

            self.assertIsNone(created)
            persisted = session.query(TimeRecord).filter_by(id="threshold-review").first()
            self.assertIsNone(persisted)

    def test_normalize_time_record_event_timezones_repairs_old_utc_mirrors(self):
        with self.SessionLocal() as session:
            record = TimeRecord(
                id="utc-mirrored-record",
                kind="practice",
                palace_id=1,
                title="Test Palace",
                started_at=datetime(2026, 5, 10, 16, 18, 9, 648000),
                ended_at=datetime(2026, 5, 10, 16, 31, 24, 463000),
                effective_seconds=628,
                pause_count=2,
                completion_method="manual_complete",
                duration_edited=False,
                events_json=json.dumps(
                    [
                        {"type": "start", "at": "2026-05-10T16:18:09.648Z"},
                        {"type": "manual_complete", "at": "2026-05-10T16:31:24.463Z"},
                    ]
                ),
            )
            session.add(record)
            session.commit()

            updated = normalize_time_record_event_timezones(session)
            session.refresh(record)

            expected_start = datetime.fromisoformat("2026-05-10T16:18:09.648+00:00").astimezone().replace(tzinfo=None)
            expected_end = datetime.fromisoformat("2026-05-10T16:31:24.463+00:00").astimezone().replace(tzinfo=None)

            self.assertEqual(updated, 1)
            self.assertEqual(record.started_at, expected_start)
            self.assertEqual(record.ended_at, expected_end)

    def test_create_time_record_normalizes_explicit_timezone_to_local_naive(self):
        response = self.client.post(
            "/api/v1/time-records",
            json={
                "id": "timezone-aware-record",
                "kind": "practice",
                "palaceId": 1,
                "palaceSegmentId": None,
                "title": "Test Palace",
                "startedAt": "2026-05-10T16:18:09.648Z",
                "endedAt": "2026-05-10T16:31:24.463Z",
                "effectiveSeconds": 628,
                "pauseCount": 2,
                "completionMethod": "manual_complete",
                "durationEdited": False,
                "deletedAt": None,
                "deletedReason": None,
                "events": [],
            },
        )
        self.assertEqual(response.status_code, 200)
        item = response.json()["item"]
        expected_start = datetime.fromisoformat("2026-05-10T16:18:09.648+00:00").astimezone().replace(tzinfo=None)
        expected_end = datetime.fromisoformat("2026-05-10T16:31:24.463+00:00").astimezone().replace(tzinfo=None)
        self.assertEqual(item["startedAt"], expected_start.isoformat())
        self.assertEqual(item["endedAt"], expected_end.isoformat())

        with self.SessionLocal() as session:
            record = session.query(TimeRecord).filter_by(id="timezone-aware-record").first()
            self.assertIsNotNone(record)
            self.assertEqual(record.started_at, expected_start)
            self.assertEqual(record.ended_at, expected_end)

    def test_update_time_record_rejects_start_after_end(self):
        response = self.client.post(
            "/api/v1/time-records",
            json={
                "id": "invalid-order-record",
                "kind": "practice",
                "palaceId": 1,
                "palaceSegmentId": None,
                "title": "Test Palace",
                "startedAt": "2026-05-11T00:18:09.648",
                "endedAt": "2026-05-11T00:31:24.463",
                "effectiveSeconds": 628,
                "pauseCount": 2,
                "completionMethod": "manual_complete",
                "durationEdited": False,
                "deletedAt": None,
                "deletedReason": None,
                "events": [],
            },
        )
        self.assertEqual(response.status_code, 200)

        update = self.client.put(
            "/api/v1/time-records/invalid-order-record",
            json={
                "startedAt": "2026-05-11T00:35:00",
                "endedAt": "2026-05-11T00:31:24.463",
            },
        )
        self.assertEqual(update.status_code, 400)
        self.assertIn("开始时间不能晚于结束时间", update.json()["detail"])

    def test_normalize_timezones_endpoint_is_idempotent(self):
        with self.SessionLocal() as session:
            session.add(
                TimeRecord(
                    id="normalize-endpoint-record",
                    kind="practice",
                    palace_id=1,
                    title="Test Palace",
                    started_at=datetime(2026, 5, 10, 16, 18, 9, 648000),
                    ended_at=datetime(2026, 5, 10, 16, 31, 24, 463000),
                    effective_seconds=628,
                    pause_count=2,
                    completion_method="manual_complete",
                    duration_edited=False,
                    events_json=json.dumps(
                        [
                            {"type": "start", "at": "2026-05-10T16:18:09.648Z"},
                            {"type": "manual_complete", "at": "2026-05-10T16:31:24.463Z"},
                        ]
                    ),
                )
            )
            session.commit()

        first = self.client.post("/api/v1/time-records/normalize-timezones")
        second = self.client.post("/api/v1/time-records/normalize-timezones")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["updated"], 1)
        self.assertEqual(second.json()["updated"], 0)

    def test_normalize_time_record_event_timezones_repairs_whole_day_shift_from_events(self):
        with self.SessionLocal() as session:
            record = TimeRecord(
                id="whole-day-shift-with-events",
                kind="review",
                palace_id=1,
                title="Test Palace / 第 1 部分",
                started_at=datetime(2026, 5, 9, 23, 37, 0),
                ended_at=datetime(2026, 5, 10, 23, 46, 0),
                effective_seconds=510,
                pause_count=1,
                completion_method="manual_complete",
                duration_edited=False,
                events_json=json.dumps(
                    [
                        {"type": "start", "at": "2026-05-09T15:37:32.055Z"},
                        {"type": "manual_complete", "at": "2026-05-09T15:46:12.830Z"},
                    ]
                ),
            )
            session.add(record)
            session.commit()

            updated = normalize_time_record_event_timezones(session)
            session.refresh(record)

            self.assertEqual(updated, 1)
            self.assertEqual(record.started_at, datetime(2026, 5, 9, 23, 37, 0))
            self.assertEqual(record.ended_at, datetime(2026, 5, 9, 23, 46, 12, 830000))

    def test_normalize_time_record_event_timezones_repairs_whole_day_shift_without_events(self):
        with self.SessionLocal() as session:
            record = TimeRecord(
                id="whole-day-shift-without-events",
                kind="review",
                palace_id=1,
                title="Test Palace",
                started_at=datetime(2026, 5, 9, 23, 37, 0),
                ended_at=datetime(2026, 5, 10, 23, 46, 0),
                effective_seconds=510,
                pause_count=0,
                completion_method="manual_complete",
                duration_edited=False,
                events_json="[]",
            )
            session.add(record)
            session.commit()

            updated = normalize_time_record_event_timezones(session)
            session.refresh(record)

            self.assertEqual(updated, 1)
            self.assertEqual(record.started_at, datetime(2026, 5, 9, 23, 37, 0))
            self.assertEqual(record.ended_at, datetime(2026, 5, 9, 23, 45, 30))

    def test_segment_review_session_uses_segment_due_semantics(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json="[]",
                sort_order=0,
            )
            session.add(segment)
            session.flush()
            schedule = PalaceSegmentReviewSchedule(
                palace_segment_id=segment.id,
                scheduled_date=date.today() - timedelta(days=1),
                interval_days=1,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=0,
                review_type="standard",
            )
            session.add(schedule)
            session.commit()

            response = self.client.post(
                f"/api/v1/segment-review/session/{schedule.id}/submit",
                json={"duration_seconds": 30, "completion_mode": "manual_complete"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["ok"])

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

    def test_virtual_default_segment_review_session_payload_is_available(self):
        response = self.client.get("/api/v1/segment-review/session/1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], 1)
        self.assertTrue(payload["segment"]["is_virtual_default"])
        self.assertEqual(payload["segment"]["display_name"], "第 1 部分")
        self.assertIn("editor_doc", payload)

    def test_virtual_default_segment_uses_actual_pending_schedule_timing(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "branch-a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "branch-b"}, "children": []},
                        ],
                    }
                }
            )
            session.add(
                PalaceSegment(
                    palace_id=palace.id,
                    name="第 2 部分",
                    color="#14b8a6",
                    node_uids_json=json.dumps(["branch-a"]),
                    sort_order=0,
                )
            )
            session.add(
                ReviewLog(
                    palace_id=palace.id,
                    review_date=date.today() - timedelta(days=2),
                    score=5,
                    review_mode="review",
                    duration_seconds=30,
                )
            )
            schedule = session.query(ReviewSchedule).filter_by(id=1).first()
            self.assertIsNotNone(schedule)
            schedule.scheduled_date = date.today() + timedelta(days=2)
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        default_segment = item["segments"][0]
        self.assertTrue(default_segment["is_virtual_default"])
        self.assertFalse(default_segment["has_due_review"])
        self.assertEqual(default_segment["current_review_schedule_id"], 1)
        self.assertTrue(
            default_segment["next_review_at"].startswith(
                (date.today() + timedelta(days=2)).isoformat()
            )
        )

    def test_virtual_default_segment_submit_uses_segment_review_route(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "branch-a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "branch-b"}, "children": []},
                        ],
                    }
                }
            )
            session.add(
                PalaceSegment(
                    palace_id=palace.id,
                    name="第 2 部分",
                    color="#14b8a6",
                    node_uids_json=json.dumps(["branch-a"]),
                    sort_order=0,
                )
            )
            session.commit()

        response = self.client.post(
            "/api/v1/segment-review/session/1/submit",
            json={"duration_seconds": 30, "completion_mode": "manual_complete"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

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

    def test_segment_review_session_routes_return_404_for_missing_schedule(self):
        response = self.client.get("/api/v1/segment-review/session/999999")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "not found")

        progress_response = self.client.get("/api/v1/segment-review/session/999999/progress")
        self.assertEqual(progress_response.status_code, 404)
        self.assertEqual(progress_response.json()["detail"], "not found")

        submit_response = self.client.post(
            "/api/v1/segment-review/session/999999/submit",
            json={"duration_seconds": 30, "completion_mode": "manual_complete"},
        )
        self.assertEqual(submit_response.status_code, 404)
        self.assertEqual(submit_response.json()["detail"], "not found")

    def test_ensure_review_log_time_records_deduplicates_existing_review_time_record(self):
        with self.SessionLocal() as session:
            review_log = ReviewLog(
                palace_id=1,
                review_date=date.today(),
                score=5,
                review_mode="review",
                duration_seconds=180,
            )
            session.add(review_log)
            session.flush()
            session.add(
                TimeRecord(
                    id="existing-review-record",
                    kind="review",
                    palace_id=1,
                    title="Test Palace",
                    started_at=datetime.combine(date.today(), datetime.min.time()) + timedelta(hours=10),
                    ended_at=datetime.combine(date.today(), datetime.min.time()) + timedelta(hours=10, seconds=180),
                    effective_seconds=180,
                    pause_count=0,
                    completion_method="manual_complete",
                    duration_edited=False,
                    events_json="[]",
                )
            )
            session.commit()

            created = ensure_review_log_time_records(session)
            active_records = (
                session.query(TimeRecord)
                .filter(TimeRecord.kind == "review", TimeRecord.deleted_at.is_(None))
                .all()
            )

            self.assertEqual(created, 0)
            self.assertEqual(len(active_records), 1)
            self.assertEqual(active_records[0].id, "existing-review-record")

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
        self.assertEqual(item["review_stage_completed"], 2)
        self.assertAlmostEqual(item["review_stage_progress"], 2 / 9)

    def test_pending_review_number_two_displays_third_progress_node(self):
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
        self.assertEqual(item["review_stage_completed"], 3)
        self.assertEqual(item["segments"][0]["review_stage_completed"], 3)

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

    def test_run_review_schedule_repair_migration_marks_completion_once(self):
        original_is_completed = main_module.is_app_migration_completed
        original_mark_completed = main_module.mark_app_migration_completed
        original_repair = main_module.repair_review_stage_progress
        calls: list[tuple[str, dict]] = []

        try:
            main_module.is_app_migration_completed = lambda key: False
            main_module.repair_review_stage_progress = lambda session: {"palace_count": 1, "segment_count": 2}
            main_module.mark_app_migration_completed = lambda key, payload: calls.append((key, payload))

            with self.SessionLocal() as session:
                result = main_module.run_review_schedule_repair_migration(session)

            self.assertEqual(result, {"palace_count": 1, "segment_count": 2})
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], main_module.REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY)
            self.assertEqual(calls[0][1]["result"], {"palace_count": 1, "segment_count": 2})
        finally:
            main_module.is_app_migration_completed = original_is_completed
            main_module.mark_app_migration_completed = original_mark_completed
            main_module.repair_review_stage_progress = original_repair

    def test_run_review_schedule_repair_migration_skips_when_already_completed(self):
        original_is_completed = main_module.is_app_migration_completed
        original_mark_completed = main_module.mark_app_migration_completed
        original_repair = main_module.repair_review_stage_progress
        repair_calls: list[int] = []
        mark_calls: list[int] = []

        try:
            main_module.is_app_migration_completed = lambda key: True
            main_module.repair_review_stage_progress = lambda session: repair_calls.append(1) or {"palace_count": 0, "segment_count": 0}
            main_module.mark_app_migration_completed = lambda key, payload: mark_calls.append(1)

            with self.SessionLocal() as session:
                result = main_module.run_review_schedule_repair_migration(session)

            self.assertIsNone(result)
            self.assertEqual(repair_calls, [])
            self.assertEqual(mark_calls, [])
        finally:
            main_module.is_app_migration_completed = original_is_completed
            main_module.mark_app_migration_completed = original_mark_completed
            main_module.repair_review_stage_progress = original_repair

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

    def test_palace_list_includes_virtual_default_segment_when_nodes_remain_unassigned(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "b"}, "children": []},
                        ],
                    }
                }
            )
            session.add(
                PalaceSegment(
                    palace_id=palace.id,
                    name="第 1 部分",
                    color="#14b8a6",
                    node_uids_json=json.dumps(["a"]),
                    sort_order=0,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        item = response.json()[0]
        self.assertEqual(len(item["segments"]), 2)
        self.assertTrue(item["segments"][0]["is_virtual_default"])
        self.assertEqual(item["segments"][0]["name"], "第 1 部分")
        self.assertEqual(item["segments"][0]["node_uids"], ["b"])
        self.assertEqual(item["segments"][1]["name"], "第 1 部分")

    def test_palace_segments_endpoint_includes_virtual_default_segment(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "b"}, "children": []},
                        ],
                    }
                }
            )
            session.add(
                PalaceSegment(
                    palace_id=palace.id,
                    name="第二部分",
                    color="#14b8a6",
                    node_uids_json=json.dumps(["a"]),
                    sort_order=0,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/segments")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 2)
        self.assertTrue(items[0]["is_virtual_default"])
        self.assertEqual(items[0]["node_uids"], ["b"])

    def test_batch_segment_review_session_returns_merged_editor_doc(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "b"}, "children": []},
                            {"data": {"text": "Branch C", "uid": "c"}, "children": []},
                        ],
                    }
                }
            )
            segment_a = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["a"]),
                sort_order=0,
            )
            segment_b = PalaceSegment(
                palace_id=palace.id,
                name="第 2 部分",
                color="#3b82f6",
                node_uids_json=json.dumps(["b"]),
                sort_order=1,
            )
            session.add_all([segment_a, segment_b])
            session.flush()
            session.add_all(
                [
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_a.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_b.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        response = self.client.post(
            "/api/v1/segment-review/batch-session",
            json={"segment_ids": [1, 2]},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["palace"]["id"], 1)
        self.assertEqual([item["id"] for item in payload["segments"]], [1, 2])
        self.assertEqual(len(payload["editor_doc"]["root"]["children"]), 2)
        self.assertEqual(
            [child["data"]["uid"] for child in payload["editor_doc"]["root"]["children"]],
            ["a", "b"],
        )

    def test_batch_segment_review_session_rejects_segments_from_other_palaces(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [{"data": {"text": "Branch A", "uid": "a"}, "children": []}],
                    }
                }
            )
            other_palace = Palace(
                title="Another Palace",
                description="",
                difficulty=0,
                review_mode="review",
                editor_doc=json.dumps(
                    {
                        "root": {
                            "data": {"text": "Another Palace"},
                            "children": [{"data": {"text": "Branch X", "uid": "x"}, "children": []}],
                        }
                    }
                ),
            )
            session.add(other_palace)
            session.flush()
            segment_a = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["a"]),
                sort_order=0,
            )
            segment_b = PalaceSegment(
                palace_id=other_palace.id,
                name="第 1 部分",
                color="#3b82f6",
                node_uids_json=json.dumps(["x"]),
                sort_order=0,
            )
            session.add_all([segment_a, segment_b])
            session.flush()
            session.add_all(
                [
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_a.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_b.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        response = self.client.post(
            "/api/v1/segment-review/batch-session",
            json={"segment_ids": [1, 2]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("同一宫殿", response.json()["detail"])

    def test_submit_batch_segment_review_only_advances_selected_segments(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = json.dumps(
                {
                    "root": {
                        "data": {"text": "Test Palace"},
                        "children": [
                            {"data": {"text": "Branch A", "uid": "a"}, "children": []},
                            {"data": {"text": "Branch B", "uid": "b"}, "children": []},
                            {"data": {"text": "Branch C", "uid": "c"}, "children": []},
                        ],
                    }
                }
            )
            segment_a = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                color="#14b8a6",
                node_uids_json=json.dumps(["a"]),
                sort_order=0,
            )
            segment_b = PalaceSegment(
                palace_id=palace.id,
                name="第 2 部分",
                color="#3b82f6",
                node_uids_json=json.dumps(["b"]),
                sort_order=1,
            )
            segment_c = PalaceSegment(
                palace_id=palace.id,
                name="第 3 部分",
                color="#f97316",
                node_uids_json=json.dumps(["c"]),
                sort_order=2,
            )
            session.add_all([segment_a, segment_b, segment_c])
            session.flush()
            session.add_all(
                [
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_a.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_b.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment_c.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                ]
            )
            session.commit()

        response = self.client.post(
            "/api/v1/segment-review/batch-session/submit",
            json={
                "segment_ids": [1, 2],
                "duration_seconds": 90,
                "completion_mode": "manual_complete",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["completed_segment_ids"], [1, 2])

        with self.SessionLocal() as session:
            completed = {
                schedule.palace_segment_id: schedule.completed
                for schedule in session.query(PalaceSegmentReviewSchedule).order_by(PalaceSegmentReviewSchedule.id).all()
                if schedule.review_number == 0
            }
            self.assertTrue(completed[1])
            self.assertTrue(completed[2])
            self.assertFalse(completed[3])

            next_schedules = (
                session.query(PalaceSegmentReviewSchedule)
                .filter(PalaceSegmentReviewSchedule.review_number == 1)
                .order_by(PalaceSegmentReviewSchedule.palace_segment_id)
                .all()
            )
            self.assertEqual([item.palace_segment_id for item in next_schedules], [1, 2])

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
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["error"], "version not found")

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
            from memory_anki.modules.backups.application import backup_service

            original_full_dir = backup_service.FULL_BACKUPS_DIR
            backup_root = Path(temp_dir)
            backup_service.FULL_BACKUPS_DIR = backup_root
            backup_root.mkdir(parents=True, exist_ok=True)
            recent = backup_root / "20260509-000000-rolling-edit"
            recent.mkdir()
            (recent / "memory_palace.db").write_text("db", encoding="utf-8")

            try:
                created = maybe_create_interval_backup("rolling-edit", ROLLING_EDIT_BACKUP_INTERVAL)
            finally:
                backup_service.FULL_BACKUPS_DIR = original_full_dir

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

        with self.assertRaises(ValueError) as error:
            self.client.put(
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
        self.assertIn("已拒绝写回宫殿", str(error.exception))

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


if __name__ == "__main__":
    unittest.main()
