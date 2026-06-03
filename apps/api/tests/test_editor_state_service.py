import unittest

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Chapter, Palace, Subject
from memory_anki.modules.mindmap.application.editor_state_service import (
    _plain_text,
    normalize_editor_doc,
    save_subject_editor_state,
)
from memory_anki.modules.palaces.application.title_sync_service import set_palace_chapter_links


class EditorStateServiceTests(unittest.TestCase):
    def test_plain_text_preserves_block_line_breaks_without_truncation(self):
        value = "<div>第一行</div><div>第二行</div><div>第三行</div>"

        result = _plain_text(value, fallback="新节点")

        self.assertEqual(result, "第一行\n第二行\n第三行")
        self.assertGreater(len(result), 8)

    def test_normalize_editor_doc_adds_stable_root_and_business_node_uids(self):
        doc = {
            "root": {
                "data": {"text": "旧标题"},
                "children": [
                    {
                        "data": {
                            "text": "第一章",
                            "memoryAnkiId": 42,
                            "memoryAnkiNodeType": "chapter",
                        },
                        "children": [],
                    }
                ],
            }
        }

        normalized = normalize_editor_doc(doc, root_text="外国教育史", root_kind="subject")

        self.assertEqual(normalized["root"]["data"]["uid"], "subject-root")
        self.assertEqual(
            normalized["root"]["children"][0]["data"]["uid"],
            "chapter-42",
        )


class SubjectEditorStateSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_save_subject_editor_state_reuses_matching_chapter_ids_and_keeps_palace_links(self):
        with self.SessionLocal() as session:
            subject = Subject(name="外国教育史", color="#334155", sort_order=0)
            session.add(subject)
            session.flush()

            parent = Chapter(
                subject_id=subject.id,
                parent_id=None,
                sort_order=0,
                name="第1章东方文明古国和古希腊的教育",
                notes="",
            )
            session.add(parent)
            session.flush()

            child = Chapter(
                subject_id=subject.id,
                parent_id=parent.id,
                sort_order=0,
                name="第一节东方文明古国的教育",
                notes="",
            )
            session.add(child)
            session.flush()

            palace = Palace(title="第一节 东方文明古国的教育", description="")
            session.add(palace)
            session.flush()
            set_palace_chapter_links(session, palace, [child.id])
            session.commit()

            imported_doc = {
                "root": {
                    "data": {"text": "目录"},
                    "children": [
                        {
                            "data": {"text": "<div>第1章东方文明古国和古希腊的教育</div>"},
                            "children": [
                                {
                                    "data": {"text": "<div>第一节东方文明古国的教育</div>"},
                                    "children": [],
                                }
                            ],
                        }
                    ],
                }
            }

            save_subject_editor_state(session, subject, {"editor_doc": imported_doc})
            session.expire_all()

            linked_ids = [
                row[0]
                for row in session.execute(
                    text("SELECT chapter_id FROM chapter_palaces WHERE palace_id = :palace_id"),
                    {"palace_id": palace.id},
                ).fetchall()
            ]
            chapters = session.query(Chapter).filter_by(subject_id=subject.id).order_by(Chapter.id).all()

            self.assertEqual([chapter.id for chapter in chapters], [parent.id, child.id])
            self.assertEqual(sorted(linked_ids), [parent.id, child.id])


if __name__ == "__main__":
    unittest.main()
