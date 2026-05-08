import unittest
from datetime import date, datetime, timedelta
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import routers.palace_router as palace_router
import routers.review_router as review_router
from models import Base, Palace, PalaceVersion, ReviewSchedule
from services.backup_service import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    create_palace_version,
    maybe_create_interval_backup,
    restore_palace_from_backup,
)
from editor_state import save_palace_editor_state
from services.session_progress_service import ensure_session_progress_schema


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
        app.include_router(review_router.router, prefix="/api")
        app.include_router(palace_router.router, prefix="/api")
        self.client = TestClient(app)

    def tearDown(self):
        review_router.get_session = self.original_get_session
        palace_router.get_session = self.original_palace_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_overdue_count_route_is_not_captured_by_schedule_id(self):
        response = self.client.get("/api/review/overdue-count")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)

    def test_review_session_includes_editor_doc(self):
        response = self.client.get("/api/review/session/1")
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

        response = self.client.get("/api/palaces/1/review-plan")
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
            "/api/practice/session/1",
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

        fetched = self.client.get("/api/practice/session/1")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["progress"]["red_node_ids"], ["1"])

        deleted = self.client.delete("/api/practice/session/1")
        self.assertEqual(deleted.status_code, 200)
        self.assertIsNone(self.client.get("/api/practice/session/1").json()["progress"])

    def test_review_progress_round_trip_and_submit_clears_it(self):
        save = self.client.put(
            "/api/review/session/1/progress",
            json={
                "reveal_map": {"root": "revealed", "1": "revealed"},
                "red_node_ids": ["1"],
                "completed": False,
            },
        )
        self.assertEqual(save.status_code, 200)
        self.assertEqual(save.json()["progress"]["review_schedule_id"], 1)

        fetched = self.client.get("/api/review/session/1/progress")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["progress"]["red_node_ids"], ["1"])

        submit = self.client.post(
            "/api/review/session/1/submit",
            json={"duration_seconds": 12, "completion_mode": "manual_complete"},
        )
        self.assertEqual(submit.status_code, 200)
        self.assertTrue(submit.json()["ok"])

        cleared = self.client.get("/api/review/session/1/progress")
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()["progress"])

    def test_review_progress_does_not_conflict_with_practice_progress_for_same_palace(self):
        practice = self.client.put(
            "/api/practice/session/1",
            json={
                "reveal_map": {"root": "revealed", "1": "placeholder"},
                "red_node_ids": [],
                "completed": False,
            },
        )
        self.assertEqual(practice.status_code, 200)

        review = self.client.put(
            "/api/review/session/1/progress",
            json={
                "reveal_map": {"root": "revealed", "1": "revealed"},
                "red_node_ids": ["1"],
                "completed": False,
            },
        )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["progress"]["review_schedule_id"], 1)

    def test_palace_version_detail_includes_editor_doc(self):
        versions_response = self.client.get("/api/palaces/1/versions")
        self.assertEqual(versions_response.status_code, 200)
        versions = versions_response.json()["versions"]
        self.assertGreaterEqual(len(versions), 1)

        version_id = versions[0]["id"]
        response = self.client.get(f"/api/palaces/1/versions/{version_id}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], version_id)
        self.assertEqual(payload["trigger_reason"], "editor_save")
        self.assertIn("editor_doc", payload)
        self.assertEqual(payload["editor_doc"]["theme"]["template"], "avocado")
        self.assertEqual(payload["editor_doc"]["root"]["children"][0]["data"]["text"], "Branch A")

    def test_palace_version_detail_rejects_wrong_version(self):
        response = self.client.get("/api/palaces/1/versions/999999")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["error"], "version not found")

    def test_create_palace_version_skips_duplicate_snapshots(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            versions_before = self.client.get("/api/palaces/1/versions").json()["versions"]
            create_palace_version(session, palace, "editor_save")
            session.commit()
            versions_after = self.client.get("/api/palaces/1/versions").json()["versions"]

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
            first_version.created_at = datetime.utcnow()
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
            first_version.created_at = datetime.utcnow() - timedelta(minutes=6)
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
            editor_version.created_at = datetime.utcnow()
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

        response = self.client.get("/api/palaces/1/versions")
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

        response = self.client.get("/api/palaces/1/versions")
        self.assertEqual(response.status_code, 200)
        versions = response.json()["versions"]
        self.assertEqual([item["trigger_reason"] for item in versions], ["editor_save", "before-version-restore", "editor_save"])

    def test_interval_backup_skips_when_recent_backup_exists(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            import services.backup_service as backup_service

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
                "/api/palaces/1/editor",
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

            palace_response = self.client.get("/api/palaces/1/editor")
            self.assertEqual(palace_response.status_code, 200)
            payload = palace_response.json()
            self.assertEqual(payload["palace"]["title"], "Recovered Palace")
            self.assertEqual(len(payload["editor_doc"]["root"]["children"]), 3)


if __name__ == "__main__":
    unittest.main()
