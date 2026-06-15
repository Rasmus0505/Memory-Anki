import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Chapter, Palace, Subject
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.palaces.presentation import router as palace_router


class PalaceChapterBindingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_knowledge_get_session = knowledge_router.get_session
        self.original_palace_get_session = palace_router.get_session

        def get_test_session():
          return self.SessionLocal()

        knowledge_router.get_session = get_test_session
        palace_router.get_session = get_test_session

        with self.SessionLocal() as session:
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

        app = FastAPI()
        app.include_router(knowledge_router.router, prefix="/api/v1")
        app.include_router(palace_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        knowledge_router.get_session = self.original_knowledge_get_session
        palace_router.get_session = self.original_palace_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

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

    def test_read_repairs_stale_primary_binding(self):
        self.client.put(
            f"/api/v1/palaces/{self.palace_id}/chapters",
            json={"chapter_ids": [self.chapter10_section1_id], "primary_chapter_id": self.chapter10_section1_id},
        )
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=self.palace_id).first()
            self.assertIsNotNone(palace)
            palace.primary_chapter_id = self.chapter10_id
            palace.title = "第十章"
            session.commit()

        palace = self.client.get(f"/api/v1/palaces/{self.palace_id}").json()
        self.assertEqual(palace["primary_chapter_id"], self.chapter10_section1_id)
        self.assertEqual(palace["resolved_title"], "第一节 第十章小节")
        self.assertEqual(palace["resolved_parent_chapter"]["id"], self.chapter10_id)

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
        self.assertNotIn("review_stages", palace_payload)


if __name__ == "__main__":
    unittest.main()
