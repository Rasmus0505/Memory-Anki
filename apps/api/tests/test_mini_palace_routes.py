import json
import unittest
from datetime import date, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import (
    Base,
    Palace,
    PalaceMiniPalace,
    PalaceMiniPalaceReviewSchedule,
    ReviewSchedule,
)
from memory_anki.modules.palaces.presentation import router as palace_router


def build_editor_doc(include_child_a: bool = True) -> str:
    children = []
    if include_child_a:
        children.append(
            {
                "data": {"text": "A", "uid": "child-a"},
                "children": [
                    {"data": {"text": "A1", "uid": "grand-a"}, "children": []},
                ],
            }
        )
    children.append({"data": {"text": "B", "uid": "child-b"}, "children": []})
    return json.dumps(
        {
            "root": {
                "data": {"text": "Test Palace", "uid": "root"},
                "children": children,
            }
        }
    )


class MiniPalaceRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = palace_router.get_session
        self.original_backup = palace_router.maybe_create_rolling_backup

        def get_test_session():
            return self.SessionLocal()

        palace_router.get_session = get_test_session
        palace_router.maybe_create_rolling_backup = lambda *_args, **_kwargs: None

        with self.SessionLocal() as session:
            palace = Palace(
                title="Test Palace",
                description="",
                editor_doc=build_editor_doc(),
            )
            session.add(palace)
            session.commit()
            self.palace_id = palace.id

        app = FastAPI()
        app.include_router(palace_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        palace_router.get_session = self.original_get_session
        palace_router.maybe_create_rolling_backup = self.original_backup

    def test_creates_default_names_and_allows_overlapping_node_sets(self):
        first = self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"name": "", "node_uids": ["root", "child-a", "child-b", "missing"]},
        )
        self.assertEqual(first.status_code, 200)
        first_payload = first.json()["item"]
        self.assertEqual(first_payload["name"], "A")
        self.assertEqual(first_payload["node_uids"], ["child-a", "child-b"])

        second = self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"name": "", "node_uids": ["child-a"]},
        )
        self.assertEqual(second.status_code, 200)
        second_payload = second.json()["item"]
        self.assertEqual(second_payload["name"], "A")
        self.assertEqual(second_payload["node_uids"], ["child-a"])

        listed = self.client.get(f"/api/v1/palaces/{self.palace_id}/mini-palaces")
        self.assertEqual(
            [item["node_uids"] for item in listed.json()["items"]],
            [["child-a", "child-b"], ["child-a"]],
        )

    def test_prefers_first_valid_selected_node_for_default_name(self):
        response = self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"name": "", "node_uids": ["root", "missing", "child-b", "child-a"]},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["item"]
        self.assertEqual(payload["name"], "B")
        self.assertEqual(payload["node_uids"], ["child-b", "child-a"])

    def test_keeps_manual_name_when_node_uids_are_present(self):
        response = self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"name": "手动命名", "node_uids": ["child-b", "child-a"]},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["item"]
        self.assertEqual(payload["name"], "手动命名")

    def test_updates_renames_deletes_and_cleans_removed_node_uids(self):
        created = self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"name": "重点", "node_uids": ["child-a", "grand-a"]},
        ).json()["item"]

        renamed = self.client.put(
            f"/api/v1/palace-mini-palaces/{created['id']}",
            json={"name": "改名", "node_uids": ["grand-a", "child-b"]},
        ).json()["item"]
        self.assertEqual(renamed["name"], "改名")
        self.assertEqual(renamed["node_uids"], ["grand-a", "child-b"])

        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=self.palace_id).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = build_editor_doc(include_child_a=False)
            session.commit()

        listed = self.client.get(f"/api/v1/palaces/{self.palace_id}/mini-palaces")
        self.assertEqual(listed.json()["items"][0]["node_uids"], ["child-b"])

        deleted = self.client.delete(f"/api/v1/palace-mini-palaces/{created['id']}")
        self.assertEqual(deleted.json(), {"ok": True})
        self.assertEqual(
            self.client.get(f"/api/v1/palaces/{self.palace_id}/mini-palaces").json()["items"],
            [],
        )

    def test_deleting_palace_cascades_mini_palaces(self):
        self.client.post(
            f"/api/v1/palaces/{self.palace_id}/mini-palaces",
            json={"node_uids": ["child-a"]},
        )
        self.client.delete(f"/api/v1/palaces/{self.palace_id}")

        with self.SessionLocal() as session:
            self.assertEqual(session.query(PalaceMiniPalace).count(), 0)

    def test_updates_mini_review_mode_and_shelf_counts_follow_mini_only_effective_review(self):
        later_today = datetime.now().replace(second=0, microsecond=0) + timedelta(hours=2)
        overdue = datetime.now().replace(second=0, microsecond=0) - timedelta(hours=1)
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=self.palace_id).first()
            self.assertIsNotNone(palace)
            mini_palace = PalaceMiniPalace(
                palace_id=palace.id,
                name="重点小宫殿",
                node_uids_json=json.dumps(["child-a"]),
                sort_order=0,
                created_at=datetime.now().replace(second=0, microsecond=0),
                updated_at=datetime.now().replace(second=0, microsecond=0),
            )
            session.add(mini_palace)
            session.flush()
            session.add(
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=overdue.date(),
                    scheduled_at=overdue,
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=0,
                    review_type="standard",
                    anchor_date=date.today(),
                )
            )
            session.add(
                PalaceMiniPalaceReviewSchedule(
                    palace_mini_palace_id=mini_palace.id,
                    scheduled_date=later_today.date(),
                    scheduled_at=later_today,
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=0,
                    review_type="standard",
                    anchor_date=date.today(),
                )
            )
            session.commit()

        grouped_before = self.client.get("/api/v1/palaces/grouped")
        self.assertEqual(grouped_before.status_code, 200)
        before_palace = grouped_before.json()["subjects"][0]["ungrouped_palaces"][0]
        self.assertEqual(before_palace["mini_review_mode"], "independent")

        shelf_before = self.client.get("/api/v1/palaces/subjects")
        self.assertEqual(shelf_before.status_code, 200)
        before_item = shelf_before.json()["items"][0]
        self.assertEqual(before_item["review_status"], "due_now")
        self.assertEqual(before_item["due_now_count"], 1)
        self.assertEqual(before_item["due_later_today_count"], 1)

        update = self.client.put(
            f"/api/v1/palaces/{self.palace_id}/mini-review-mode",
            json={"mini_review_mode": "mini_only"},
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()["item"]["mini_review_mode"], "mini_only")

        shelf_after = self.client.get("/api/v1/palaces/subjects")
        self.assertEqual(shelf_after.status_code, 200)
        after_item = shelf_after.json()["items"][0]
        self.assertEqual(after_item["review_status"], "due_later_today")
        self.assertEqual(after_item["due_now_count"], 0)
        self.assertEqual(after_item["due_later_today_count"], 1)


if __name__ == "__main__":
    unittest.main()
