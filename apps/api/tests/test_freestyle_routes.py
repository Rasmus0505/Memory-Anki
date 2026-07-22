import json
import unittest
from datetime import timedelta
from unittest.mock import patch

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english import EnglishCourse, EnglishCourseProgress
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingMaterial,
    EnglishReadingVersion,
)
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
    PalaceSegment,
)
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.practice.application import feed_service
from memory_anki.modules.practice.presentation import router as freestyle_router
from support import RouterTestCase


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


class FreestyleRouteTests(RouterTestCase):
    ROUTER_MODULES = (freestyle_router,)

    def seed(self, session):
        subject = Subject(name="生物", color="#22c55e")
        session.add(subject)
        session.flush()
        chapter = Chapter(subject_id=subject.id, name="细胞生物学", sort_order=0)
        session.add(chapter)
        session.flush()

        palace = Palace(
            title="细胞宫殿",
            archived=False,
            mastered=False,
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"text": "细胞宫殿", "uid": "root"},
                        "children": [{"data": {"text": "A", "uid": "a"}, "children": []}],
                    }
                }
            ),
        )
        practice_palace = Palace(
            title="练习宫殿",
            archived=False,
            mastered=False,
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
            name="细胞核迷你宫殿训练",
            node_uids_json=json.dumps(["a"], ensure_ascii=False),
            sort_order=0,
        )
        session.add_all([segment, mini_palace])
        session.flush()

        # Seed a formal-due FSRS node so freestyle review cards appear.
        past = utc_now_naive() - timedelta(days=1)
        session.add(
            ReviewNodeState(
                palace_id=palace.id,
                node_uid="a",
                state=2,
                stability=3.0,
                difficulty=5.0,
                due_at=past,
                raw_due_at=past,
                last_review_at=past - timedelta(days=3),
                schedule_source="manual",
                content_fingerprint="",
            )
        )
        session.flush()

        session.add_all(
            [
                quiz_question(palace_id=palace.id, stem="细胞宫殿题"),
                quiz_question(palace_id=practice_palace.id, stem="练习宫殿题"),
                quiz_question(palace_id=archived_palace.id, stem="归档宫殿题"),
                quiz_question(source_chapter_id=chapter.id, stem="章节聚合题"),
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

    def test_feed_aggregates_quiz_and_learning_action_cards(self):
        response = self.client.get("/api/v1/freestyle/feed")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        content_types = {card["content_type"] for card in payload["cards"]}
        self.assertIn("quiz_question", content_types)
        self.assertIn("review", content_types)
        # needs_practice action cards are retired; practice may be absent from the feed.
        self.assertIn("english", content_types)
        self.assertIn("english_reading", content_types)
        stems = [
            card["question"]["stem"]
            for card in payload["cards"]
            if card["type"] == "quiz_question"
        ]
        self.assertIn("章节聚合题", stems)
        self.assertNotIn("归档宫殿题", stems)

    def test_feed_deduplicates_repeated_questions_and_sorts_stably(self):
        with self.SessionLocal() as session:
            chapter = session.query(Chapter).filter_by(name="细胞生物学").one()
            practice_palace = session.get(Palace, self.practice_palace_id)
            practice_palace.chapters.append(chapter)
            session.commit()

        response = self.client.get("/api/v1/freestyle/feed")

        self.assertEqual(response.status_code, 200)
        cards = response.json()["cards"]
        question_cards = [card for card in cards if card["type"] == "quiz_question"]
        question_ids = [card["question"]["id"] for card in question_cards]
        self.assertEqual(len(question_ids), len(set(question_ids)))

        chapter_cards = [
            card for card in question_cards if card["question"]["stem"] == "章节聚合题"
        ]
        self.assertEqual(len(chapter_cards), 1)
        self.assertEqual(chapter_cards[0]["palace_context"]["id"], self.palace_id)

        self.assertEqual(cards[0]["content_type"], "review")
        # New due nodes without a past due_at are priority 100; overdue uses 110.
        self.assertIn(cards[0]["priority"], (100, 110))
        self.assertEqual(
            [card["question"]["stem"] for card in cards[1:3]],
            ["细胞宫殿题", "章节聚合题"],
        )
        action_priorities = [
            card["priority"] for card in cards if card["type"] == "action"
        ]
        self.assertEqual(action_priorities, sorted(action_priorities, reverse=True))

    def test_feed_deduplicates_card_ids_and_keeps_highest_priority(self):
        low_priority_card = {
            "id": "english:duplicate",
            "type": "action",
            "content_type": "english",
            "action_kind": "english",
            "title": "Low priority",
            "subtitle": "Older duplicate",
            "href": "/english/courses/1",
            "priority": 10,
            "reason": "duplicate",
        }
        high_priority_card = {
            **low_priority_card,
            "title": "High priority",
            "subtitle": "Preferred duplicate",
            "priority": 90,
        }

        with patch.object(
            feed_service,
            "_build_english_card_from_course",
            return_value=[low_priority_card, high_priority_card],
        ):
            response = self.client.get("/api/v1/freestyle/feed?content_types=english")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["counts"]["english"], 1)
        self.assertEqual(len(payload["cards"]), 1)
        self.assertEqual(payload["cards"][0]["id"], "english:duplicate")
        self.assertEqual(payload["cards"][0]["title"], "High priority")
        self.assertEqual(payload["cards"][0]["priority"], 90)

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

    def test_wrong_range_returns_only_wrong_quiz_cards(self):
        with self.SessionLocal() as session:
            wrong_question = session.query(PalaceQuizQuestion).filter_by(stem="细胞宫殿题").one()
            wrong_question.attempt_count = 3
            wrong_question.correct_count = 1
            wrong_question.incorrect_count = 2
            session.commit()

        response = self.client.get("/api/v1/freestyle/feed?range=wrong")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            set(payload["counts"].keys()),
            {"quiz_question", "review", "practice", "english", "english_reading"},
        )
        self.assertEqual([card["content_type"] for card in payload["cards"]], ["quiz_question"])
        self.assertEqual(payload["cards"][0]["question"]["stem"], "细胞宫殿题")
        self.assertEqual(payload["cards"][0]["question"]["incorrect_count"], 2)

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
