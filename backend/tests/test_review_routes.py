import unittest
from datetime import date, timedelta
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import routers.palace_router as palace_router
import routers.review_router as review_router
from models import Base, Palace, ReviewSchedule


class ReviewRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
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


if __name__ == "__main__":
    unittest.main()
