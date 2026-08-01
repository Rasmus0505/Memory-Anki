import unittest

from sqlalchemy import text

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
)
from memory_anki.modules.content.application.title_sync_service import set_palace_chapter_links
from memory_anki.modules.knowledge.application.editor_state_service import save_subject_editor_state
from memory_anki.modules.mindmap_document.api import EditorStateConflictError, normalize_editor_doc
from memory_anki.modules.produce.application.mindmap_ai_split.primitives import plain_text
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

    def test_save_palace_editor_state_allows_intentional_autosave_branch_delete(self):
        """Normal editor autosave must accept intentional multi-node deletes."""
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
            after_delete_doc = {
                "root": {
                    "data": {"text": "古罗马教育", "memoryAnkiRootKind": "palace"},
                    "children": [
                        {"data": {"text": f"节点{i}", "uid": f"node-{i}"}, "children": []}
                        for i in range(1, 5)
                    ],
                }
            }
            palace.editor_doc = str(fresh_doc).replace("'", '"')
            session.commit()

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": after_delete_doc,
                    "editor_source": "palace_edit_autosave",
                },
            )

            self.assertEqual(len(result["editor_doc"]["root"]["children"]), 4)
            self.assertEqual(
                result["editor_doc"]["root"]["children"][0]["data"]["text"], "节点1"
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
            expected_fingerprint = get_palace_editor_state(palace)["editor_fingerprint"]

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": imported_doc,
                    "editor_source": "import_apply",
                    "sync_reason": "import_apply",
                    "expected_editor_fingerprint": expected_fingerprint,
                    "confirm_dangerous_change": True,
                },
            )

            self.assertEqual(
                result["editor_doc"]["root"]["children"][0]["data"]["text"], "导入节点1"
            )

    def test_save_palace_editor_state_rejects_stale_bypass_from_normal_editor(self):
        with self.SessionLocal() as session:
            palace = Palace(title="古罗马教育", description="")
            session.add(palace)
            session.flush()

            with self.assertRaisesRegex(ValueError, "拒绝普通编辑器保存绕过版本校验"):
                save_palace_editor_state(
                    session,
                    palace,
                    {
                        "editor_doc": {
                            "root": {
                                "data": {"text": "古罗马教育"},
                                "children": [],
                            }
                        },
                        "editor_source": "palace_edit",
                        "allow_stale_overwrite": True,
                    },
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


class PalaceEditorReconcileGateTests(RouterTestCase):
    def _marked_doc(self, node_text: str = "节点 A", *, mark: bool = True) -> dict:
        root_data = {
            "uid": "root",
            "text": "复习门控宫殿",
            "memoryAnkiRootKind": "palace",
        }
        if mark:
            root_data["permanentSplitMark"] = True
        return {
            "root": {
                "data": root_data,
                "children": [
                    {
                        "data": {"uid": "node-a", "text": node_text},
                        "children": [],
                    }
                ],
            }
        }

    def _seed_unit(self, session, *, stage_index: int = 3, due_date=None):
        from datetime import date, timedelta

        from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

        palace = Palace(title="复习门控宫殿", description="")
        session.add(palace)
        session.flush()
        save_palace_editor_state(
            session,
            palace,
            {
                "editor_doc": self._marked_doc(),
                "editor_source": "palace_edit",
            },
        )
        session.expire_all()
        palace = session.get(Palace, palace.id)
        assert palace is not None
        unit = (
            session.query(ReviewUnitState)
            .filter_by(palace_id=palace.id, active=True)
            .one()
        )
        unit.stage_index = stage_index
        unit.has_passed = True
        unit.due_date = due_date or (date.today() + timedelta(days=14))
        unit.revision += 1
        session.commit()
        return palace, unit

    def test_autosave_text_change_skips_reconcile_and_keeps_stage(self):
        from datetime import date

        from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

        with self.SessionLocal() as session:
            palace, unit = self._seed_unit(session, stage_index=3)
            due_before = unit.due_date
            stage_before = unit.stage_index
            content_hash_before = unit.content_hash

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc("节点 A 已改字"),
                    "editor_source": "palace_edit_autosave",
                },
            )
            session.expire_all()
            unit = session.get(ReviewUnitState, unit.id)
            assert unit is not None

            self.assertNotIn("unit_reconcile", result)
            self.assertEqual(unit.stage_index, stage_before)
            self.assertEqual(unit.due_date, due_before)
            self.assertEqual(unit.content_hash, content_hash_before)
            self.assertGreater(unit.due_date, date.today())

    def test_reconcile_flag_or_editor_leave_demotes_and_returns_changes(self):
        from datetime import date

        from memory_anki.infrastructure.db._tables.unit_reviews import (
            ReviewUnitScheduleBatch,
            ReviewUnitState,
        )

        with self.SessionLocal() as session:
            palace, unit = self._seed_unit(session, stage_index=3)
            stage_before = unit.stage_index
            due_before = unit.due_date

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc("节点 A 离开时保存"),
                    "editor_source": "palace_edit_autosave",
                    "sync_reason": "editor_leave",
                },
            )
            session.expire_all()
            unit = session.get(ReviewUnitState, unit.id)
            assert unit is not None
            reconcile = result.get("unit_reconcile") or {}
            changes = reconcile.get("changes") or []

            self.assertTrue(reconcile.get("changed"))
            self.assertEqual(unit.stage_index, stage_before - 1)
            self.assertEqual(unit.due_date, date.today())
            self.assertEqual(unit.due_date.isoformat() != due_before.isoformat(), True)
            self.assertTrue(any(item.get("action") == "content_demoted" for item in changes))
            self.assertTrue(reconcile.get("undo_token"))
            batch = session.get(ReviewUnitScheduleBatch, reconcile["undo_token"])
            self.assertIsNotNone(batch)
            self.assertEqual(batch.reason, "content_reconcile")

            # Explicit reconcile_units also demotes even without leave reason.
            unit.stage_index = 2
            unit.due_date = date.today().replace(year=date.today().year + 1)
            session.commit()
            flagged = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc("节点 A 显式 reconcile"),
                    "editor_source": "palace_edit_autosave",
                    "reconcile_units": True,
                },
            )
            session.expire_all()
            unit = session.get(ReviewUnitState, unit.id)
            assert unit is not None
            self.assertEqual(unit.stage_index, 1)
            self.assertEqual(unit.due_date, date.today())
            self.assertTrue((flagged.get("unit_reconcile") or {}).get("changes"))

    def test_mark_toggle_on_plain_autosave_defers_membership_reconcile(self):
        """Mid-pass mark toggles only persist doc; schedule waits for mark_change/leave."""
        from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

        with self.SessionLocal() as session:
            palace, unit = self._seed_unit(session, stage_index=2)
            unit_id = unit.id
            stage_before = unit.stage_index

            plain = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc(mark=False),
                    "editor_source": "palace_edit_autosave",
                },
            )
            session.expire_all()
            unit = session.get(ReviewUnitState, unit_id)
            assert unit is not None

            self.assertNotIn("unit_reconcile", plain)
            self.assertTrue(unit.active)
            self.assertEqual(unit.stage_index, stage_before)

            finished = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc(mark=False),
                    "editor_source": "palace_edit_autosave",
                    "sync_reason": "mark_change",
                },
            )
            session.expire_all()
            unit = session.get(ReviewUnitState, unit_id)
            assert unit is not None
            reconcile = finished.get("unit_reconcile") or {}
            changes = reconcile.get("changes") or []

            self.assertFalse(unit.active)
            self.assertTrue(reconcile.get("changed"))
            self.assertTrue(any(item.get("action") == "deactivated" for item in changes))
            self.assertEqual(reconcile.get("unit_count"), 0)
            self.assertTrue(reconcile.get("mark_required"))


class PalaceEditorShortCircuitTests(RouterTestCase):
    def _doc(self, node_count: int = 3) -> dict:
        return {
            "root": {
                "data": {"text": "短路宫殿", "memoryAnkiRootKind": "palace"},
                "children": [
                    {"data": {"text": f"节点{i}", "uid": f"node-{i}"}, "children": []}
                    for i in range(1, node_count + 1)
                ],
            }
        }

    def test_identical_doc_autosave_is_a_noop_short_circuit(self):
        from memory_anki.infrastructure.db._tables.palaces import PalaceVersion, Peg

        with self.SessionLocal() as session:
            palace = Palace(title="短路宫殿", description="")
            session.add(palace)
            session.flush()

            first = save_palace_editor_state(
                session,
                palace,
                {"editor_doc": self._doc(), "editor_source": "palace_edit_autosave"},
            )
            session.expire_all()
            palace = session.get(Palace, palace.id)
            assert palace is not None
            peg_count = session.query(Peg).filter_by(palace_id=palace.id).count()
            version_count = session.query(PalaceVersion).filter_by(palace_id=palace.id).count()
            updated_at = palace.updated_at
            stored_doc = palace.editor_doc

            second = save_palace_editor_state(
                session,
                palace,
                {"editor_doc": first["editor_doc"], "editor_source": "palace_edit_autosave"},
            )
            session.expire_all()
            palace = session.get(Palace, palace.id)
            assert palace is not None

            self.assertEqual(
                session.query(Peg).filter_by(palace_id=palace.id).count(), peg_count
            )
            self.assertEqual(
                session.query(PalaceVersion).filter_by(palace_id=palace.id).count(),
                version_count,
            )
            self.assertEqual(palace.updated_at, updated_at)
            self.assertEqual(palace.editor_doc, stored_doc)
            self.assertEqual(second["editor_doc"], first["editor_doc"])
            self.assertNotIn("unit_reconcile", second)

    def test_editor_state_response_snapshot_has_no_duplicate_document(self):
        with self.SessionLocal() as session:
            palace = Palace(title="响应瘦身", description="")
            session.add(palace)
            session.flush()

            result = save_palace_editor_state(
                session,
                palace,
                {"editor_doc": self._doc(1), "editor_source": "palace_edit_autosave"},
            )
            self.assertIn("editor_doc", result)
            self.assertNotIn("document", result["snapshot"])
            self.assertEqual(result["snapshot"]["revision"], result["editor_fingerprint"])

            state = get_palace_editor_state(palace)
            self.assertNotIn("document", state["snapshot"])


class PalaceEditorReturnToReviewTests(PalaceEditorReconcileGateTests):
    def test_return_to_review_with_identical_doc_reconciles_without_rewriting_doc(self):
        from memory_anki.infrastructure.db._tables.palaces import PalaceVersion, Peg
        from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

        with self.SessionLocal() as session:
            palace, unit = self._seed_unit(session, stage_index=3)
            stage_before = unit.stage_index

            saved = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": self._marked_doc("节点 A 返回前已改"),
                    "editor_source": "palace_edit_autosave",
                },
            )
            session.expire_all()
            palace = session.get(Palace, palace.id)
            unit = session.get(ReviewUnitState, unit.id)
            assert palace is not None and unit is not None
            peg_count = session.query(Peg).filter_by(palace_id=palace.id).count()
            version_count = session.query(PalaceVersion).filter_by(palace_id=palace.id).count()
            stored_before = palace.editor_doc

            result = save_palace_editor_state(
                session,
                palace,
                {
                    "editor_doc": saved["editor_doc"],
                    "editor_source": "palace_edit_autosave",
                    "sync_reason": "return_to_review",
                },
            )
            session.expire_all()
            palace = session.get(Palace, palace.id)
            unit = session.get(ReviewUnitState, unit.id)
            assert palace is not None and unit is not None
            reconcile = result.get("unit_reconcile") or {}
            changes = reconcile.get("changes") or []

            self.assertEqual(
                session.query(Peg).filter_by(palace_id=palace.id).count(), peg_count
            )
            self.assertEqual(
                session.query(PalaceVersion).filter_by(palace_id=palace.id).count(),
                version_count,
            )
            self.assertEqual(palace.editor_doc, stored_before)
            self.assertTrue(reconcile.get("changed"))
            self.assertTrue(any(item.get("action") == "content_demoted" for item in changes))
            self.assertEqual(unit.stage_index, stage_before - 1)


class PalaceVersionSignatureQueryTests(RouterTestCase):
    def test_version_signature_loads_all_pegs_in_single_query(self):
        from sqlalchemy import event

        from memory_anki.infrastructure.db._tables.palaces import Peg
        from memory_anki.modules.backups.application.backup_palace_versions import (
            build_version_signature_from_palace,
        )

        with self.SessionLocal() as session:
            palace = Palace(title="深树宫殿", description="")
            session.add(palace)
            session.flush()
            for root_index in range(3):
                root = Peg(
                    palace_id=palace.id,
                    parent_id=None,
                    sort_order=root_index,
                    name=f"根{root_index}",
                    content="",
                )
                session.add(root)
                session.flush()
                child = Peg(
                    palace_id=palace.id,
                    parent_id=root.id,
                    sort_order=0,
                    name=f"根{root_index}-子",
                    content="",
                )
                session.add(child)
                session.flush()
                session.add(
                    Peg(
                        palace_id=palace.id,
                        parent_id=child.id,
                        sort_order=0,
                        name=f"根{root_index}-孙",
                        content="",
                    )
                )
                session.flush()
            session.commit()

            peg_selects: list[str] = []

            def count_peg_selects(conn, cursor, statement, parameters, context, executemany):
                if "FROM PEGS" in str(statement).upper():
                    peg_selects.append(str(statement))

            bind = session.get_bind()
            event.listen(bind, "before_cursor_execute", count_peg_selects)
            try:
                build_version_signature_from_palace(session, palace)
            finally:
                event.remove(bind, "before_cursor_execute", count_peg_selects)

            self.assertEqual(len(peg_selects), 1)


if __name__ == "__main__":
    unittest.main()
