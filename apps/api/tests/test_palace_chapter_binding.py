import unittest

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.palaces.presentation import router as palace_router
from support import RouterTestCase


class PalaceChapterBindingTests(RouterTestCase):
    ROUTER_MODULES = (knowledge_router, palace_router)

    def seed(self, session):
        subject = Subject(name="中国教育史", color="#6366f1", sort_order=0)
        session.add(subject)
        session.flush()

        chapter9 = Chapter(subject_id=subject.id, parent_id=None, name="第九章", sort_order=0)
        chapter10 = Chapter(subject_id=subject.id, parent_id=None, name="第十章", sort_order=1)
        session.add_all([chapter9, chapter10])
        session.flush()

        chapter9_section1 = Chapter(
            subject_id=subject.id,
            parent_id=chapter9.id,
            name="第一节 第九章小节",
            sort_order=0,
        )
        chapter10_section1 = Chapter(
            subject_id=subject.id,
            parent_id=chapter10.id,
            name="第一节 第十章小节",
            sort_order=0,
        )
        session.add_all([chapter9_section1, chapter10_section1])
        session.flush()

        palace = Palace(title="未命名宫殿", description="")
        session.add(palace)
        session.commit()

        self.subject_id = subject.id
        self.chapter9_id = chapter9.id
        self.chapter10_id = chapter10.id
        self.chapter9_section1_id = chapter9_section1.id
        self.chapter10_section1_id = chapter10_section1.id
        self.palace_id = palace.id

    def test_linking_single_subchapter_keeps_primary_on_subchapter(self):
        response = self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter10_section1_id], "primary_chapter_id": self.chapter10_section1_id},
        )
        self.assertEqual(response.status_code, 200)

        palace = self.client.get(f"/api/v1/palaces/{self.palace_id}").json()
        self.assertEqual(palace["primary_chapter_id"], self.chapter10_section1_id)
        self.assertEqual(palace["resolved_title"], "第一节 第十章小节")
        self.assertEqual(palace["resolved_parent_chapter"]["id"], self.chapter10_id)

        chapter_flags = {item["id"]: item["is_explicit"] for item in palace["chapters"]}
        self.assertEqual(chapter_flags[self.chapter10_section1_id], True)
        self.assertEqual(chapter_flags[self.chapter10_id], False)

    def test_latest_selected_subchapter_becomes_primary(self):
        first = self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter9_section1_id], "primary_chapter_id": self.chapter9_section1_id},
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={
                "chapter_ids": [self.chapter9_section1_id, self.chapter10_section1_id],
                "primary_chapter_id": self.chapter10_section1_id,
            },
        )
        self.assertEqual(second.status_code, 200)

        palace = self.client.get(f"/api/v1/palaces/{self.palace_id}").json()
        self.assertEqual(palace["primary_chapter_id"], self.chapter10_section1_id)
        self.assertEqual(palace["resolved_title"], "第一节 第十章小节")
        self.assertEqual(palace["resolved_parent_chapter"]["id"], self.chapter10_id)

    def test_unselecting_current_primary_falls_back_to_remaining_deepest_explicit_chapter(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={
                "chapter_ids": [self.chapter9_section1_id, self.chapter10_section1_id],
                "primary_chapter_id": self.chapter10_section1_id,
            },
        )
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter9_section1_id], "primary_chapter_id": None},
        )

        palace = self.client.get(f"/api/v1/palaces/{self.palace_id}").json()
        self.assertEqual(palace["primary_chapter_id"], self.chapter9_section1_id)
        self.assertEqual(palace["resolved_title"], "第一节 第九章小节")
        self.assertEqual(palace["resolved_parent_chapter"]["id"], self.chapter9_id)

    def test_read_preserves_stale_binding_until_explicit_update(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={
                "chapter_ids": [self.chapter10_section1_id],
                "primary_chapter_id": self.chapter10_section1_id,
            },
        )
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=self.palace_id).first()
            self.assertIsNotNone(palace)
            palace.primary_chapter_id = self.chapter10_id
            palace.title = "第十章"
            session.commit()

        palace = self.client.get(f"/api/v1/palaces/{self.palace_id}").json()
        self.assertEqual(palace["primary_chapter_id"], self.chapter10_id)
        with self.SessionLocal() as session:
            persisted = session.query(Palace).filter_by(id=self.palace_id).one()
            self.assertEqual(persisted.primary_chapter_id, self.chapter10_id)

        updated = self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={
                "chapter_ids": [self.chapter10_section1_id],
                "primary_chapter_id": self.chapter10_section1_id,
            },
        ).json()
        self.assertEqual(updated["primary_chapter_id"], self.chapter10_section1_id)

    def test_grouped_summary_omits_heavy_fields_and_includes_counts(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter10_section1_id], "primary_chapter_id": self.chapter10_section1_id},
        )

        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=self.palace_id).first()
            self.assertIsNotNone(palace)
            palace.editor_doc = '{"root":{"data":{"text":"test","uid":"root"},"children":[]}}'
            session.commit()

        response = self.client.get("/api/v1/palaces/grouped-summary")
        self.assertEqual(response.status_code, 200)

        subjects = response.json()["subjects"]
        self.assertEqual(len(subjects), 1)
        palace_payload = subjects[0]["chapter_groups"][0]["palaces"][0]
        self.assertEqual(palace_payload["segment_count"], 0)
        self.assertEqual(palace_payload["chapter_count"], 2)
        self.assertNotIn("editor_doc", palace_payload)
        self.assertNotIn("segments", palace_payload)
        self.assertNotIn("mini_palaces", palace_payload)
        self.assertIn("review_stages", palace_payload)
        self.assertEqual(len(palace_payload["review_stages"]), palace_payload["review_stage_total"])

    def test_chapter_detail_includes_palace_review_status(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter10_section1_id], "primary_chapter_id": self.chapter10_section1_id},
        )

        response = self.client.get(f"/api/v1/chapters/{self.chapter10_section1_id}")
        self.assertEqual(response.status_code, 200)

        palace_payload = response.json()["palaces"][0]
        self.assertEqual(palace_payload["id"], self.palace_id)
        self.assertIn("pegs", palace_payload)
        self.assertEqual(palace_payload["mastered"], False)
        self.assertEqual(palace_payload["archived"], False)
        self.assertEqual(palace_payload["review_stage_completed"], 0)
        self.assertEqual(palace_payload["review_stage_total"], 0)
        self.assertIsNone(palace_payload["next_due_date"])

    def test_delete_bound_chapter_requires_force_and_reports_impact(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter10_section1_id], "primary_chapter_id": self.chapter10_section1_id},
        )
        with self.SessionLocal() as session:
            question = PalaceQuizQuestion(
                source_chapter_id=self.chapter10_section1_id,
                stem="教育史题目",
                options_json="[]",
                answer_payload_json="{}",
                analysis="",
                source_meta_json="{}",
            )
            session.add(question)
            session.commit()
            question_id = question.id

        response = self.client.delete(f"/api/v1/chapters/{self.chapter10_section1_id}")
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertEqual(payload["requires_force"], True)
        self.assertEqual(payload["chapter_count"], 1)
        self.assertEqual(payload["linked_palace_count"], 1)
        self.assertEqual(payload["question_count"], 1)

        forced = self.client.delete(f"/api/v1/chapters/{self.chapter10_section1_id}?force=true")
        self.assertEqual(forced.status_code, 200)
        self.assertEqual(forced.json()["ok"], True)

        with self.SessionLocal() as session:
            self.assertIsNone(session.query(Chapter).filter_by(id=self.chapter10_section1_id).first())
            self.assertIsNone(session.query(PalaceQuizQuestion).filter_by(id=question_id).first())

    def test_delete_empty_chapter_succeeds_without_force(self):
        response = self.client.delete(f"/api/v1/chapters/{self.chapter9_section1_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)

        with self.SessionLocal() as session:
            self.assertIsNone(session.query(Chapter).filter_by(id=self.chapter9_section1_id).first())


if __name__ == "__main__":
    unittest.main()
