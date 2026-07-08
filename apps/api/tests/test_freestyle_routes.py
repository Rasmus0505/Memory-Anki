import json
import unittest
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import (
    Base,
    Chapter,
    EnglishCourse,
    EnglishCourseProgress,
    EnglishReadingMaterial,
    EnglishReadingVersion,
    ExternalAiCallLog,
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
    PalaceSegment,
    ReviewSchedule,
    Subject,
)
from memory_anki.modules.freestyle.presentation import router as freestyle_router


def quiz_question(**kwargs):
    payload = {
        "question_type": "multiple_choice",
        "stem": "默认题干",
        "options_json": json.dumps(
            [{"id": "A", "text": "A"}, {"id": "B", "text": "B"}],
            ensure_ascii=False,
        ),
        "answer_payload_json": json.dumps({"correct_option_id": "A"}, ensure_ascii=False),
        "analysis": "解析",
        "source_meta_json": json.dumps({"source_kind": "manual"}, ensure_ascii=False),
        "sort_order": 0,
    }
    payload.update(kwargs)
    return PalaceQuizQuestion(**payload)


class FreestyleRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = freestyle_router.get_session

        def get_test_session():
            return self.SessionLocal()

        freestyle_router.get_session = get_test_session

        with self.SessionLocal() as session:
            subject = Subject(name="生物", color="#22c55e")
            session.add(subject)
            session.flush()
            chapter = Chapter(subject_id=subject.id, name="细胞生物学", sort_order=0)
            session.add(chapter)
            session.flush()

            palace = Palace(title="细胞宫殿", archived=False, mastered=False)
            practice_palace = Palace(
                title="练习宫殿",
                archived=False,
                mastered=False,
                needs_practice=True,
                focus_node_uids_json=json.dumps(["focus-a"], ensure_ascii=False),
            )
            archived_palace = Palace(title="归档宫殿", archived=True, mastered=False)
            session.add_all([palace, practice_palace, archived_palace])
            session.flush()
            palace.chapters.append(chapter)

            segment = PalaceSegment(
                palace_id=palace.id,
                name="第 1 部分",
                node_uids_json=json.dumps(["a"], ensure_ascii=False),
                sort_order=0,
            )
            mini_palace = PalaceMiniPalace(
                palace_id=palace.id,
                name="细胞核专项训练",
                node_uids_json=json.dumps(["a"], ensure_ascii=False),
                needs_practice=True,
                sort_order=0,
            )
            session.add_all([segment, mini_palace])
            session.flush()

            session.add_all(
                [
                    quiz_question(palace_id=palace.id, stem="细胞宫殿题"),
                    quiz_question(palace_id=practice_palace.id, stem="练习宫殿题"),
                    quiz_question(palace_id=archived_palace.id, stem="归档宫殿题"),
                    quiz_question(source_chapter_id=chapter.id, stem="章节聚合题"),
                    ReviewSchedule(
                        palace_id=palace.id,
                        scheduled_date=date.today() - timedelta(days=1),
                        interval_days=1,
                        algorithm_used="ebbinghaus",
                        completed=False,
                        review_number=0,
                        review_type="standard",
                    ),
                ]
            )

            course = EnglishCourse(
                title="English Course",
                original_filename="demo.mp4",
                media_filename="source.mp4",
                media_relative_path="1/source.mp4",
                sentence_count=10,
                duration_seconds=120,
            )
            session.add(course)
            session.flush()
            session.add(
                EnglishCourseProgress(
                    course_id=course.id,
                    current_sentence_index=3,
                    completed_sentence_indexes_json="[]",
                    is_completed=False,
                )
            )

            material = EnglishReadingMaterial(
                title="Reading Material",
                source_type="paste",
                original_filename="",
                original_text="hello world",
                cleaned_text="hello world",
                word_count=2,
            )
            session.add(material)
            session.flush()
            session.add(
                EnglishReadingVersion(
                    material_id=material.id,
                    render_blocks_json="[]",
                    span_annotations_json="[]",
                    sentence_annotations_json="[]",
                    summary_json="{}",
                )
            )
            session.commit()

            self.palace_id = palace.id
            self.practice_palace_id = practice_palace.id

        app = FastAPI()
        app.include_router(freestyle_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        freestyle_router.get_session = self.original_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_feed_aggregates_quiz_and_learning_action_cards(self):
        response = self.client.get("/api/v1/freestyle/feed")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        content_types = {card["content_type"] for card in payload["cards"]}
        self.assertIn("quiz_question", content_types)
        self.assertIn("review", content_types)
        self.assertIn("practice", content_types)
        self.assertIn("english", content_types)
        self.assertIn("english_reading", content_types)
        stems = [
            card["question"]["stem"]
            for card in payload["cards"]
            if card["type"] == "quiz_question"
        ]
        self.assertIn("章节聚合题", stems)
        self.assertNotIn("归档宫殿题", stems)

    def test_content_type_filter_returns_only_quiz_cards(self):
        response = self.client.get("/api/v1/freestyle/feed?content_types=quiz_question")

        self.assertEqual(response.status_code, 200)
        cards = response.json()["cards"]
        self.assertTrue(cards)
        self.assertTrue(all(card["content_type"] == "quiz_question" for card in cards))

    def test_specific_palaces_filter_excludes_global_english_cards(self):
        response = self.client.get(
            f"/api/v1/freestyle/feed?range=specific_palaces&palace_ids={self.practice_palace_id}"
        )

        self.assertEqual(response.status_code, 200)
        cards = response.json()["cards"]
        self.assertTrue(cards)
        self.assertTrue(
            all(
                card.get("palace_context", {}).get("id") == self.practice_palace_id
                for card in cards
            )
        )
        self.assertNotIn("english", {card["content_type"] for card in cards})

    def test_due_range_keeps_due_palace_work_and_skips_practice_actions(self):
        response = self.client.get("/api/v1/freestyle/feed?range=due")

        self.assertEqual(response.status_code, 200)
        cards = response.json()["cards"]
        content_types = {card["content_type"] for card in cards}
        self.assertIn("quiz_question", content_types)
        self.assertIn("review", content_types)
        self.assertNotIn("practice", content_types)
        self.assertNotIn("english", content_types)
        self.assertTrue(
            all(
                card.get("palace_context", {}).get("id") == self.palace_id
                for card in cards
                if card.get("palace_context")
            )
        )

    def test_records_and_filters_freestyle_question_attempts(self):
        response = self.client.post(
            "/api/v1/freestyle/question-attempts",
            json={
                "question_id": 1,
                "palace_id": self.palace_id,
                "palace_title": "细胞宫殿",
                "mode": "today",
                "question_type": "multiple_choice",
                "stem_snapshot": "细胞宫殿题",
                "answer_payload": {"selected_option_id": "A"},
                "is_correct": True,
            },
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["item"]
        self.assertEqual(item["question_id"], 1)
        self.assertEqual(item["palace_id"], self.palace_id)
        self.assertEqual(item["mode"], "today")
        self.assertEqual(item["answer_payload"]["selected_option_id"], "A")
        self.assertTrue(item["is_correct"])

        filtered = self.client.get(
            f"/api/v1/freestyle/question-attempts?palace_id={self.palace_id}&mode=today"
        )

        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()["items"]), 1)
        self.assertEqual(filtered.json()["items"][0]["id"], item["id"])

    def test_records_and_filters_freestyle_ai_explanations(self):
        response = self.client.post(
            "/api/v1/freestyle/question-explanations",
            json={
                "question_id": 1,
                "palace_id": self.palace_id,
                "palace_title": "细胞宫殿",
                "question_type": "multiple_choice",
                "stem_snapshot": "细胞宫殿题",
                "user_question": "为什么选 A？",
                "explanation_text": "因为 A 是正确选项。",
                "ai_call_log_id": "log-explain",
            },
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["item"]
        self.assertEqual(item["user_question"], "为什么选 A？")
        self.assertEqual(item["explanation_text"], "因为 A 是正确选项。")
        self.assertEqual(item["ai_call_log_id"], "log-explain")

        filtered = self.client.get(
            f"/api/v1/freestyle/question-explanations?question_id=1&palace_id={self.palace_id}"
        )

        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()["items"]), 1)
        self.assertEqual(filtered.json()["items"][0]["id"], item["id"])

    def test_history_summary_returns_legacy_quiz_and_ai_log_counts(self):
        with self.SessionLocal() as session:
            question = session.query(PalaceQuizQuestion).filter_by(id=1).one()
            question.attempt_count = 3
            question.correct_count = 2
            question.incorrect_count = 1
            session.add_all(
                [
                    ExternalAiCallLog(
                        id="log-explain",
                        feature="题目讲解",
                        operation="palace_quiz_question_explain",
                        status="success",
                        provider="test",
                        model="demo",
                        request_id="req-1",
                    ),
                    ExternalAiCallLog(
                        id="log-feedback",
                        feature="简答点评",
                        operation="palace_quiz_short_answer_feedback",
                        status="success",
                        provider="test",
                        model="demo",
                        request_id="req-2",
                    ),
                ]
            )
            session.commit()

        response = self.client.get("/api/v1/freestyle/history-summary")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["legacy_quiz"]["attempted_question_count"], 1)
        self.assertEqual(payload["legacy_quiz"]["attempt_count"], 3)
        self.assertEqual(payload["legacy_quiz"]["correct_count"], 2)
        self.assertEqual(payload["legacy_quiz"]["incorrect_count"], 1)
        self.assertEqual(payload["legacy_ai_logs"]["total_count"], 2)


if __name__ == "__main__":
    unittest.main()
