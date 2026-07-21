"""Routes for English topic sentence patterns (句模) + FSRS."""

from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english import (
    EnglishCourse,
    EnglishPatternSentence,
    EnglishSentence,
)
from memory_anki.modules.english.presentation import router as english_router
from support import RouterTestCase


class EnglishPatternRoutesTests(RouterTestCase):
    ROUTER_MODULES = (english_router,)

    def test_create_seeded_pattern_and_fill_sentences(self):
        created = self.client.post(
            "/api/v1/english/patterns",
            json={"title": "Food", "tags": ["daily"], "seedTemplate": True},
        )
        self.assertEqual(created.status_code, 200, created.text)
        payload = created.json()
        self.assertEqual(payload["title"], "Food")
        self.assertEqual(payload["promptCount"], 6)
        self.assertEqual(payload["slotCount"], 12)
        self.assertEqual(payload["sentenceCount"], 0)
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(len(payload["prompts"]), 6)
        self.assertEqual(len(payload["prompts"][0]["sentences"]), 2)

        prompt = payload["prompts"][0]
        sentence = prompt["sentences"][0]
        updated = self.client.post(
            f"/api/v1/english/patterns/prompts/{prompt['id']}/sentences",
            json={
                "sentenceId": sentence["id"],
                "textEn": (
                    "I love baked fish with tomato sauce, but if I have a choice "
                    "between fish and chicken breast, I will go for the chicken breast."
                ),
                "textZh": "我喜欢番茄酱烤鱼，但更想吃鸡胸。",
                "source": "manual",
            },
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        sentence_payload = updated.json()
        self.assertTrue(sentence_payload["textEn"].startswith("I love baked fish"))
        self.assertTrue(sentence_payload["isDue"])
        self.assertEqual(sentence_payload["algorithmUsed"], "FSRS")
        self.assertEqual(sentence_payload["reviewType"], "fsrs")

        detail = self.client.get(f"/api/v1/english/patterns/{payload['id']}")
        self.assertEqual(detail.status_code, 200)
        detail_payload = detail.json()
        self.assertEqual(detail_payload["sentenceCount"], 1)
        self.assertEqual(detail_payload["status"], "learning")
        self.assertEqual(detail_payload["dueCount"], 1)

    def test_list_due_and_review_advances_fsrs(self):
        created = self.client.post(
            "/api/v1/english/patterns",
            json={"title": "Travel", "seedTemplate": False},
        )
        self.assertEqual(created.status_code, 200)
        pattern_id = created.json()["id"]

        prompted = self.client.post(
            f"/api/v1/english/patterns/{pattern_id}/prompts",
            json={"textEn": "Do you like traveling?", "textZh": "你喜欢旅行吗？"},
        )
        self.assertEqual(prompted.status_code, 200)
        prompt_id = prompted.json()["prompts"][0]["id"]

        sentence = self.client.post(
            f"/api/v1/english/patterns/prompts/{prompt_id}/sentences",
            json={
                "textEn": "I enjoy slow travel because it lets me notice local details.",
                "textZh": "我喜欢慢旅行，因为能注意到当地细节。",
            },
        )
        self.assertEqual(sentence.status_code, 200)
        sentence_id = sentence.json()["id"]

        due = self.client.get("/api/v1/english/patterns/sentences/due")
        self.assertEqual(due.status_code, 200)
        due_payload = due.json()
        self.assertEqual(due_payload["dueCount"], 1)
        self.assertEqual(due_payload["items"][0]["id"], sentence_id)
        self.assertEqual(due_payload["items"][0]["patternTitle"], "Travel")

        reviewed = self.client.post(
            f"/api/v1/english/patterns/sentences/{sentence_id}/review",
            json={"result": "good"},
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.text)
        reviewed_payload = reviewed.json()
        self.assertEqual(reviewed_payload["reviewCount"], 1)
        self.assertEqual(reviewed_payload["correctCount"], 1)
        self.assertEqual(reviewed_payload["reviewNumber"], 1)
        self.assertFalse(reviewed_payload["isDue"])

        due_after = self.client.get("/api/v1/english/patterns/sentences/due")
        self.assertEqual(due_after.status_code, 200)
        self.assertEqual(due_after.json()["dueCount"], 0)

        with self.SessionLocal() as session:
            row = session.get(EnglishPatternSentence, sentence_id)
            assert row is not None
            row.due_at = utc_now_naive() - timedelta(minutes=5)
            row.next_due_at = row.due_at
            row.next_due_date = row.due_at.date()
            session.commit()

        due_again = self.client.get(
            "/api/v1/english/patterns/sentences/due",
            params={"patternId": pattern_id},
        )
        self.assertEqual(due_again.status_code, 200)
        self.assertEqual(due_again.json()["dueCount"], 1)

    def test_collect_from_listening_sentence(self):
        with self.SessionLocal() as session:
            course = EnglishCourse(
                title="Demo",
                original_filename="demo.mp4",
                media_filename="demo.mp4",
                media_relative_path="demo.mp4",
                sentence_count=1,
            )
            session.add(course)
            session.flush()
            source = EnglishSentence(
                course_id=course.id,
                sentence_index=0,
                text_en="I love baked fish with tomato sauce.",
                text_zh="我喜欢番茄酱烤鱼。",
            )
            session.add(source)
            session.commit()
            course_id = course.id
            sentence_id = source.id

        collected = self.client.post(
            "/api/v1/english/patterns/collect",
            json={
                "patternTitle": "Food from listening",
                "promptTextZh": "你喜欢吃鱼吗？",
                "textEn": "I love baked fish with tomato sauce.",
                "textZh": "我喜欢番茄酱烤鱼。",
                "source": "from_listening",
                "sourceCourseId": course_id,
                "sourceSentenceId": sentence_id,
            },
        )
        self.assertEqual(collected.status_code, 200, collected.text)
        payload = collected.json()
        self.assertEqual(payload["pattern"]["title"], "Food from listening")
        self.assertEqual(payload["pattern"]["sentenceCount"], 1)
        self.assertEqual(payload["sentence"]["source"], "from_listening")
        self.assertEqual(payload["sentence"]["sourceSentenceId"], sentence_id)
        self.assertTrue(payload["sentence"]["isDue"])

        listed = self.client.get("/api/v1/english/patterns")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 1)
        self.assertEqual(listed.json()["dueSentenceCount"], 1)

    def test_delete_pattern(self):
        created = self.client.post(
            "/api/v1/english/patterns",
            json={"title": "Temp", "seedTemplate": False},
        )
        pattern_id = created.json()["id"]
        deleted = self.client.delete(f"/api/v1/english/patterns/{pattern_id}")
        self.assertEqual(deleted.status_code, 200)
        missing = self.client.get(f"/api/v1/english/patterns/{pattern_id}")
        self.assertEqual(missing.status_code, 404)
