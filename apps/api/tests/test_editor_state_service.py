import unittest

from sqlalchemy import text

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.knowledge.application.editor_state_service import save_subject_editor_state
from memory_anki.modules.mindmap_document.api import EditorStateConflictError, normalize_editor_doc
from memory_anki.modules.palaces.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
)
from memory_anki.modules.palaces.application.mindmap_ai_split.primitives import plain_text
from memory_anki.modules.palaces.application.title_sync_service import set_palace_chapter_links
from support import RouterTestCase


class EditorStateServiceTests(unittest.TestCase):
    def test_plain_text_preserves_block_line_breaks_without_truncation(self):
        value = "<div>第一行</div><div>第二行</div><div>第三行</div>"

        result = plain_text(value, fallback="新节点")

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


class SubjectEditorStateSyncTests(RouterTestCase):
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
            chapters = (
                session.query(Chapter).filter_by(subject_id=subject.id).order_by(Chapter.id).all()
            )

            self.assertEqual([chapter.id for chapter in chapters], [parent.id, child.id])
            self.assertEqual(sorted(linked_ids), [parent.id, child.id])

    def test_save_palace_editor_state_blocks_stale_bootstrap_autosave_overwrite(self):
        with self.SessionLocal() as session:
            palace = Palace(title="古罗马教育", description="")
            session.add(palace)
            session.flush()

            fresh_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": f"节点{i}", "uid": f"node-{i}"}, "children": []}
                        for i in range(1, 9)
                    ],
                }
            }
            stale_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": f"节点{i}", "uid": f"node-{i}"}, "children": []}
                        for i in range(1, 4)
                    ],
                }
            }
            palace.editor_doc = str(fresh_doc).replace("'", '"')
            session.commit()

            with self.assertRaisesRegex(ValueError, "已阻止旧态覆盖当前宫殿"):
                save_palace_editor_state(
                    session,
                    palace,
                    {
                        "editor_doc": stale_doc,
                        "editor_source": "host_bootstrap_sync",
                        "sync_reason": "initial_hydration",
                    },
                )

    def test_save_palace_editor_state_allows_import_apply_explicit_overwrite(self):
        with self.SessionLocal() as session:
            palace = Palace(title="古罗马教育", description="")
            session.add(palace)
            session.flush()

            fresh_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": f"节点{i}", "uid": f"node-{i}"}, "children": []}
                        for i in range(1, 9)
                    ],
                }
            }
            imported_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": "导入节点1", "uid": "import-1"}, "children": []},
                        {"data": {"text": "导入节点2", "uid": "import-2"}, "children": []},
                    ],
                }
            }
            palace.editor_doc = str(fresh_doc).replace("'", '"')
            session.commit()

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": imported_doc,
                    "editor_source": "import_apply",
                    "sync_reason": "import_apply",
                    "allow_stale_overwrite": True,
                },
            )

            self.assertEqual(
                result["editor_doc"]["root"]["children"][0]["data"]["text"], "导入节点1"
            )

    def test_save_palace_editor_state_rejects_stale_expected_fingerprint(self):
        with self.SessionLocal() as session:
            palace = Palace(title="古罗马教育", description="")
            session.add(palace)
            session.flush()

            initial_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [{"data": {"text": "旧节点", "uid": "node-old"}, "children": []}],
                }
            }
            newer_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": "服务端新节点", "uid": "node-server"}, "children": []}
                    ],
                }
            }
            local_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": "本地离线节点", "uid": "node-local"}, "children": []}
                    ],
                }
            }

            save_palace_editor_state(session, palace, {"editor_doc": initial_doc})
            stale_fingerprint = get_palace_editor_state(palace)["editor_fingerprint"]
            save_palace_editor_state(session, palace, {"editor_doc": newer_doc})

            with self.assertRaisesRegex(EditorStateConflictError, "脑图保存冲突"):
                save_palace_editor_state(
                    session,
                    palace,
                    {
                        "editor_doc": local_doc,
                        "expected_editor_fingerprint": stale_fingerprint,
                    },
                )


if __name__ == "__main__":
    unittest.main()
