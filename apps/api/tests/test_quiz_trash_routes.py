import json

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.presentation import router as palace_quiz_router
from support import RouterTestCase


class QuizTrashRouteTests(RouterTestCase):
    ROUTER_MODULES = (palace_quiz_router,)

    def setUp(self):
        super().setUp()
        # The app engine turns FK enforcement on at connect time (see
        # infrastructure/db/_tables/_base.py); mirror it so ON DELETE CASCADE
        # behaves the same under the test engine's StaticPool connection.
        with self.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()

    def seed(self, session):
        palace = Palace(
            title="回收站宫殿",
            description="trash",
            editor_doc=json.dumps(
                {"root": {"data": {"text": "回收站宫殿", "uid": "root"}, "children": []}},
                ensure_ascii=False,
            ),
        )
        session.add(palace)
        session.flush()
        session.add_all(
            [
                PalaceQuizQuestion(
                    palace_id=palace.id,
                    question_type="short_answer",
                    stem=f"第 {index} 题",
                    options_json="[]",
                    answer_payload_json=json.dumps({"reference_answer": "答案"}, ensure_ascii=False),
                    analysis="解析",
                    source_meta_json=json.dumps(
                        {
                            "source_kind": "manual",
                            "subject_document_id": None,
                            "page_numbers": None,
                            "image_names": None,
                            "extra_prompt": "",
                            "ai_call_log_id": None,
                            "generated_at": "2026-06-12T00:00:00",
                            "generation_mode": "manual",
                        },
                        ensure_ascii=False,
                    ),
                    sort_order=index,
                )
                for index in (1, 2, 3)
            ]
        )
        session.commit()

    def _question_ids(self):
        with self.SessionLocal() as session:
            rows = (
                session.query(PalaceQuizQuestion)
                .order_by(PalaceQuizQuestion.sort_order.asc())
                .all()
            )
            return [row.id for row in rows]

    def _soft_delete(self, question_id):
        response = self.client.delete(f"/api/v1/palace-quiz-questions/{question_id}")
        self.assertEqual(response.status_code, 200)

    def test_trash_list_returns_only_deleted_sorted_by_deleted_at(self):
        first_id, second_id, active_id = self._question_ids()
        self._soft_delete(first_id)
        self._soft_delete(second_id)
        with self.SessionLocal() as session:
            first = session.get(PalaceQuizQuestion, first_id)
            second = session.get(PalaceQuizQuestion, second_id)
            active = session.get(PalaceQuizQuestion, active_id)
            first.deleted_at = first.deleted_at.replace(microsecond=1000)
            second.deleted_at = second.deleted_at.replace(microsecond=2000)
            active.attempt_count = 7
            active.correct_count = 5
            session.commit()

        response = self.client.get("/api/v1/palace-quiz-questions/trash")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual([item["id"] for item in payload["items"]], [second_id, first_id])
        newest = payload["items"][0]
        self.assertEqual(newest["palace_title"], "回收站宫殿")
        self.assertFalse(newest["palace_deleted"])
        self.assertIsNotNone(newest["deleted_at"])
        self.assertNotIn(active_id, [item["id"] for item in payload["items"]])

    def test_trash_list_pagination(self):
        first_id, second_id, _active_id = self._question_ids()
        self._soft_delete(first_id)
        self._soft_delete(second_id)

        page_one = self.client.get("/api/v1/palace-quiz-questions/trash?limit=1&offset=0")
        page_two = self.client.get("/api/v1/palace-quiz-questions/trash?limit=1&offset=1")

        self.assertEqual(page_one.status_code, 200)
        payload_one = page_one.json()
        self.assertEqual(payload_one["total"], 2)
        self.assertEqual(len(payload_one["items"]), 1)
        payload_two = page_two.json()
        self.assertEqual(payload_two["total"], 2)
        self.assertEqual(len(payload_two["items"]), 1)
        self.assertNotEqual(payload_one["items"][0]["id"], payload_two["items"][0]["id"])

    def test_permanent_delete_removes_row_and_rejects_active_question(self):
        first_id, _second_id, active_id = self._question_ids()
        self._soft_delete(first_id)
        with self.SessionLocal() as session:
            session.add(
                PalaceQuizQuestionNodeBinding(
                    question_id=first_id,
                    palace_id=1,
                    node_uid="root",
                )
            )
            session.commit()

        active_response = self.client.delete(f"/api/v1/palace-quiz-questions/{active_id}/permanent")
        self.assertEqual(active_response.status_code, 400)

        response = self.client.delete(f"/api/v1/palace-quiz-questions/{first_id}/permanent")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

        with self.SessionLocal() as session:
            self.assertIsNone(session.get(PalaceQuizQuestion, first_id))
            binding_count = (
                session.query(PalaceQuizQuestionNodeBinding)
                .filter(PalaceQuizQuestionNodeBinding.question_id == first_id)
                .count()
            )
            self.assertEqual(binding_count, 0)
            self.assertIsNotNone(session.get(PalaceQuizQuestion, active_id))

        trash_response = self.client.get("/api/v1/palace-quiz-questions/trash")
        self.assertNotIn(first_id, [item["id"] for item in trash_response.json()["items"]])

    def test_purge_only_clears_trash(self):
        first_id, second_id, active_id = self._question_ids()
        self._soft_delete(first_id)
        self._soft_delete(second_id)

        response = self.client.post("/api/v1/palace-quiz-questions/trash/purge")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["purged_count"], 2)

        with self.SessionLocal() as session:
            self.assertIsNone(session.get(PalaceQuizQuestion, first_id))
            self.assertIsNone(session.get(PalaceQuizQuestion, second_id))
            self.assertIsNotNone(session.get(PalaceQuizQuestion, active_id))

        list_response = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertEqual(
            [item["id"] for item in list_response.json()["items"]],
            [active_id],
        )
