from __future__ import annotations

import json
from datetime import datetime, timedelta

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
)
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.palace_quiz.presentation import router as palace_quiz_router
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.settings.presentation import router as settings_router
from support import RouterTestCase


class FablePaginationResponseModelTests(RouterTestCase):
    ROUTER_MODULES = (
        palace_router,
        knowledge_router,
        palace_quiz_router,
        review_router,
        settings_router,
    )

    def seed(self, session):
        base = datetime(2026, 7, 9, 8, 0, 0)
        subject_a = Subject(name="Biology", color="#22c55e", sort_order=2)
        subject_b = Subject(name="Chemistry", color="#f97316", sort_order=1)
        session.add_all([subject_a, subject_b])
        session.flush()

        palace_old = Palace(
            title="Old Palace",
            description="old",
            updated_at=base,
        )
        palace_new = Palace(
            title="New Palace",
            description="new",
            updated_at=base + timedelta(minutes=10),
        )
        session.add_all([palace_old, palace_new])
        session.flush()
        session.add_all(
            [
                PalaceQuizQuestion(
                    palace_id=palace_new.id,
                    question_type="multiple_choice",
                    stem="Question A",
                    options_json=json.dumps([{"id": "A", "text": "A"}]),
                    answer_payload_json=json.dumps({"correct_option_ids": ["A"]}),
                    sort_order=1,
                ),
                PalaceQuizQuestion(
                    palace_id=palace_new.id,
                    question_type="short_answer",
                    stem="Question B",
                    options_json="[]",
                    answer_payload_json=json.dumps({"answer": "B"}),
                    sort_order=2,
                ),
            ]
        )
        session.commit()
        self.palace_id = palace_new.id

    def test_palaces_default_shape_and_paginated_shape(self):
        response = self.client.get("/api/v1/palaces")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsInstance(payload, list)
        self.assertEqual([item["title"] for item in payload], ["New Palace", "Old Palace"])

        response = self.client.get("/api/v1/palaces?limit=1&offset=1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["limit"], 1)
        self.assertEqual(payload["offset"], 1)
        self.assertEqual([item["title"] for item in payload["items"]], ["Old Palace"])

    def test_subjects_default_shape_and_paginated_shape(self):
        response = self.client.get("/api/v1/subjects")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsInstance(payload, list)
        self.assertEqual([item["name"] for item in payload], ["Chemistry", "Biology"])

        response = self.client.get("/api/v1/subjects?limit=1&offset=1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual([item["name"] for item in payload["items"]], ["Biology"])

    def test_quiz_question_lists_default_shape_and_paginated_shape(self):
        response = self.client.get(f"/api/v1/palaces/{self.palace_id}/quiz-questions")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), {"items"})
        self.assertEqual([item["stem"] for item in payload["items"]], ["Question A", "Question B"])

        response = self.client.get(
            f"/api/v1/palaces/{self.palace_id}/aggregated-quiz-questions?limit=1&offset=1"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["limit"], 1)
        self.assertEqual(payload["offset"], 1)
        self.assertEqual([item["stem"] for item in payload["items"]], ["Question B"])

    def test_large_list_pagination_query_validation(self):
        for path in (
            "/api/v1/palaces?limit=0",
            "/api/v1/subjects?limit=501",
            f"/api/v1/palaces/{self.palace_id}/quiz-questions?limit=1&offset=-1",
            f"/api/v1/palaces/{self.palace_id}/aggregated-quiz-questions?limit=0",
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 422)

    def test_response_model_schemas_are_registered_in_openapi(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        schemas = response.json()["components"]["schemas"]
        for name in (
            "RuntimeHealthResponse",
            "RuntimeInfoResponse",
            "SettingsResponse",
            "ReviewQueueResponse",
            "ReviewScheduleItem",
            "SubmitReviewResponse",
            "PalaceSummaryResponse",
            "PaginatedPalaceListResponse",
        ):
            self.assertIn(name, schemas)

        review_response = self.client.get("/api/v1/review/queue")
        self.assertEqual(review_response.status_code, 200)
        self.assertIn("reviews", review_response.json())
