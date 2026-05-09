import json
import tempfile
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Palace, PalaceVersion, ReviewLog, ReviewSchedule, TimeRecord
from memory_anki.modules.backups.application.backup_service import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    create_palace_version,
    maybe_create_interval_backup,
    restore_palace_from_backup,
)
from memory_anki.modules.mindmap.application.editor_state_service import save_palace_editor_state
from memory_anki.modules.reviews.application.review_service import submit_review
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.sessions.application.session_progress_service import (
    ensure_session_progress_schema,
)
from memory_anki.modules.time_records.application.time_records_service import (
    ensure_review_log_time_records,
    get_today_total_review_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
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

        def get_test_session():
            return self.SessionLocal()

        review_router.get_session = get_test_session
        palace_router.get_session = get_test_session

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
                                {"data": {"text": "Branch A", "note": "Detail A"}, "children": []},
                                {"data": {"text": "Branch B"}, "children": []},
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
        self.client = TestClient(app)

    def tearDown(self):
        review_router.get_session = self.original_get_session
        palace_router.get_session = self.original_palace_get_session
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
                    scheduled_date=date.today(),
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
        self.assertEqual(payload["reviews"][0]["overdue_schedule_count"], 1)

    def test_submit_review_completes_all_due_schedules_for_same_palace(self):
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
            completed_due = [schedule for schedule in schedules if schedule.review_number in (0, 1, 2)]
            self.assertEqual(len(completed_due), 3)
            self.assertTrue(all(schedule.completed for schedule in completed_due))
            pending = [schedule for schedule in schedules if not schedule.completed]
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0].review_number, 3)

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

            self.assertEqual(get_weekly_formal_review_duration_seconds(session), 120)
            self.assertEqual(get_today_total_review_duration_seconds(session), 360)
            self.assertEqual(get_weekly_total_review_duration_seconds(session), 360)

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

    def test_palace_review_plan_marks_same_day_multiple_reviews(self):
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
        self.assertEqual(len(payload["plan"]), 2)
        self.assertEqual(payload["plan"][0]["sequence_label"], "第 1 次复习")
        self.assertEqual(payload["plan"][0]["same_day_index"], 1)
        self.assertEqual(payload["plan"][0]["same_day_total"], 2)
        self.assertEqual(payload["plan"][1]["sequence_label"], "第 2 次复习")
        self.assertEqual(payload["plan"][1]["same_day_index"], 2)
        self.assertEqual(payload["plan"][1]["same_day_total"], 2)

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
