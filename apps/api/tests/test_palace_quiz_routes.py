import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import (
    FreestyleQuizAttempt,
    Palace,
    PalaceMiniPalace,
    PalaceQuizOcrSource,
    PalaceQuizQuestion,
    PalaceSegment,
)
from memory_anki.modules.content.application.title_sync_service import (
    reconcile_palace_chapter_binding,
    set_palace_chapter_links,
)
from memory_anki.modules.quiz.presentation import router as palace_quiz_router
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.platform.application import MUTATION_ID_HEADER
from support import RouterTestCase


class PalaceQuizRouteTests(RouterTestCase):
    ROUTER_MODULES = (palace_quiz_router, settings_router)

    def seed(self, session):
        palace = Palace(
            title="Quiz Palace",
            description="desc",
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"text": "Quiz Palace", "uid": "root"},
                        "children": [
                            {
                                "data": {"text": "细胞核", "uid": "cell-core"},
                                "children": [],
                            },
                            {
                                "data": {"text": "有丝分裂", "uid": "mitosis"},
                                "children": [],
                            },
                        ],
                    }
                },
                ensure_ascii=False,
            ),
        )
        other_palace = Palace(
            title="Other Palace",
            description="other",
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"text": "Other Palace", "uid": "other-root"},
                        "children": [
                            {
                                "data": {"text": "单链入口", "uid": "single-1"},
                                "children": [
                                    {
                                        "data": {"text": "继续单链", "uid": "single-2"},
                                        "children": [
                                            {
                                                "data": {"text": "分支A", "uid": "branch-a"},
                                                "children": [],
                                            },
                                            {
                                                "data": {"text": "分支B", "uid": "branch-b"},
                                                "children": [],
                                            },
                                        ],
                                    }
                                ],
                            }
                        ],
                    }
                },
                ensure_ascii=False,
            ),
        )
        subject = Subject(name="生物", color="#22c55e")
        session.add_all([palace, other_palace, subject])
        session.flush()
        segment_a = PalaceSegment(
            palace_id=palace.id,
            name="细胞核学习组",
            color="#14b8a6",
            node_uids_json=json.dumps(["cell-core"], ensure_ascii=False),
            sort_order=0,
        )
        segment_b = PalaceSegment(
            palace_id=palace.id,
            name="重点学习组",
            color="#f97316",
            node_uids_json=json.dumps(["cell-core", "mitosis"], ensure_ascii=False),
            sort_order=1,
        )
        session.add_all([segment_a, segment_b])
        session.flush()
        chapter = Chapter(subject_id=subject.id, name="细胞生物学", sort_order=0)
        session.add(chapter)
        session.flush()
        child_chapter = Chapter(subject_id=subject.id, parent_id=chapter.id, name="细胞核", sort_order=0)
        unrelated_chapter = Chapter(subject_id=subject.id, name="遗传学", sort_order=1)
        session.add(child_chapter)
        session.add(unrelated_chapter)
        session.flush()
        palace.chapters.append(chapter)
        session.add(
            PalaceMiniPalace(
                palace_id=palace.id,
                name="细胞核迷你宫殿训练",
                node_uids_json=json.dumps(["cell-core"], ensure_ascii=False),
                sort_order=0,
            )
        )
        session.add_all(
            [
                PalaceQuizQuestion(
                    palace_id=palace.id,
                    question_type="multiple_choice",
                    stem="细胞的控制中心是？",
                    options_json=json.dumps(
                        [
                            {"id": "A", "text": "细胞膜"},
                            {"id": "B", "text": "细胞核"},
                        ],
                        ensure_ascii=False,
                    ),
                    answer_payload_json=json.dumps(
                        {"correct_option_id": "B"},
                        ensure_ascii=False,
                    ),
                    analysis="细胞核控制细胞活动。",
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
                    sort_order=1,
                ),
                PalaceQuizQuestion(
                    palace_id=palace.id,
                    question_type="short_answer",
                    stem="简述有丝分裂的意义。",
                    options_json="[]",
                    answer_payload_json=json.dumps(
                        {"reference_answer": "保证遗传信息稳定传递。"},
                        ensure_ascii=False,
                    ),
                    analysis="核心在于遗传物质平均分配。",
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
                    sort_order=2,
                ),
            ]
        )
        session.commit()
        self.chapter_id = chapter.id
        self.child_chapter_id = child_chapter.id
        self.unrelated_chapter_id = unrelated_chapter.id
        self.segment_ids = [segment_a.id, segment_b.id]

    def test_quiz_crud_and_palace_isolation(self):
        response = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 2)

        empty_response = self.client.get("/api/v1/palaces/2/quiz-questions")
        self.assertEqual(empty_response.status_code, 200)
        self.assertEqual(empty_response.json()["items"], [])

        create_response = self.client.post(
            "/api/v1/palaces/2/quiz-questions",
            json={
                "question_type": "multiple_choice",
                "stem": "DNA 的基本单位是？",
                "options": [
                    {"id": "A", "text": "核苷酸"},
                    {"id": "B", "text": "氨基酸"},
                ],
                "answer_payload": {"correct_option_id": "A"},
                "analysis": "DNA 由核苷酸组成。",
            },
        )
        self.assertEqual(create_response.status_code, 200)
        created = create_response.json()["item"]
        self.assertEqual(created["palace_id"], 2)
        self.assertEqual(created["sort_order"], 1)

        update_response = self.client.put(
            f"/api/v1/palace-quiz-questions/{created['id']}",
            json={
                "question_type": "short_answer",
                "stem": "说明 DNA 的基本组成单位。",
                "answer_payload": {"reference_answer": "核苷酸"},
                "analysis": "注意单位层级。",
            },
        )
        self.assertEqual(update_response.status_code, 200)
        updated = update_response.json()["item"]
        self.assertEqual(updated["question_type"], "short_answer")
        self.assertEqual(updated["answer_payload"]["reference_answer"], "核苷酸")

        delete_response = self.client.delete(
            f"/api/v1/palace-quiz-questions/{created['id']}"
        )
        self.assertEqual(delete_response.status_code, 200)
        self.assertTrue(delete_response.json()["ok"])

        final_response = self.client.get("/api/v1/palaces/2/quiz-questions")
        self.assertEqual(final_response.status_code, 200)
        self.assertEqual(final_response.json()["items"], [])

    def test_question_can_share_content_across_multiple_learning_groups(self):
        response = self.client.post(
            "/api/v1/palaces/1/quiz-questions",
            json={
                "segment_ids": self.segment_ids,
                "question_type": "short_answer",
                "stem": "细胞核与有丝分裂有什么关系？",
                "answer_payload": {"reference_answer": "细胞核中的遗传物质参与有丝分裂。"},
                "analysis": "共享题目内容，但可属于多个学习组。",
            },
        )

        self.assertEqual(response.status_code, 200)
        item = response.json()["item"]
        self.assertEqual(item["segment_ids"], self.segment_ids)
        self.assertEqual([segment["id"] for segment in item["segments"]], self.segment_ids)
        self.assertEqual(item["attempt_count"], 0)

    def test_delete_soft_deletes_hides_from_lists_and_restore_recovers(self):
        with self.SessionLocal() as session:
            question = session.query(PalaceQuizQuestion).filter_by(palace_id=1).first()
            self.assertIsNotNone(question)
            question_id = question.id
            question.incorrect_count = 2
            question.attempt_count = 3
            session.commit()

        delete_response = self.client.delete(f"/api/v1/palace-quiz-questions/{question_id}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertTrue(delete_response.json()["ok"])
        repeat_response = self.client.delete(f"/api/v1/palace-quiz-questions/{question_id}")
        self.assertEqual(repeat_response.status_code, 200)
        self.assertTrue(repeat_response.json()["ok"])

        list_response = self.client.get("/api/v1/palaces/1/quiz-questions")
        wrong_response = self.client.get("/api/v1/palace-quiz-questions/wrong?limit=10")
        with self.SessionLocal() as session:
            retained = session.get(PalaceQuizQuestion, question_id)

        self.assertIsNotNone(retained)
        self.assertIsNotNone(retained.deleted_at)
        self.assertNotIn(question_id, [item["id"] for item in list_response.json()["items"]])
        self.assertNotIn(
            question_id,
            [item["question"]["id"] for item in wrong_response.json()["items"]],
        )

        restore_response = self.client.post(f"/api/v1/palace-quiz-questions/{question_id}/restore")
        self.assertEqual(restore_response.status_code, 200)
        self.assertEqual(restore_response.json()["item"]["id"], question_id)

        restored_response = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertIn(question_id, [item["id"] for item in restored_response.json()["items"]])

    def test_wrong_questions_endpoint_orders_by_error_rate_and_last_wrong_time(self):
        with self.SessionLocal() as session:
            first = session.query(PalaceQuizQuestion).filter_by(stem="细胞的控制中心是？").one()
            second = session.query(PalaceQuizQuestion).filter_by(stem="简述有丝分裂的意义。").one()
            first.attempt_count = 4
            first.correct_count = 1
            first.incorrect_count = 3
            second.attempt_count = 10
            second.correct_count = 8
            second.incorrect_count = 2
            session.add(
                FreestyleQuizAttempt(
                    question_id=first.id,
                    palace_id=1,
                    palace_title="Quiz Palace",
                    mode="free",
                    question_type="multiple_choice",
                    stem_snapshot=first.stem,
                    answer_payload_json=json.dumps({"selected_option_id": "A"}, ensure_ascii=False),
                    is_correct=False,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palace-quiz-questions/wrong?limit=10")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual([item["question"]["stem"] for item in payload["items"]], [
            "细胞的控制中心是？",
            "简述有丝分裂的意义。",
        ])
        first_item = payload["items"][0]
        self.assertEqual(first_item["palace_id"], 1)
        self.assertEqual(first_item["palace_title"], "Quiz Palace")
        self.assertEqual(first_item["incorrect_count"], 3)
        self.assertEqual(first_item["correct_count"], 1)
        self.assertEqual(first_item["attempt_count"], 4)
        self.assertIsNotNone(first_item["last_wrong_at"])

    def test_quiz_list_is_read_only_and_dedupe_is_explicit(self):
        with self.SessionLocal() as session:
            original = session.query(PalaceQuizQuestion).filter_by(palace_id=1).first()
            duplicate = PalaceQuizQuestion(
                palace_id=1,
                question_type=original.question_type,
                stem=original.stem,
                options_json=original.options_json,
                answer_payload_json=original.answer_payload_json,
                analysis=original.analysis,
                source_meta_json=original.source_meta_json,
                sort_order=99,
            )
            session.add(duplicate)
            session.commit()

        list_response = self.client.get("/api/v1/palaces/1/quiz-questions")
        with self.SessionLocal() as session:
            count_after_list = session.query(PalaceQuizQuestion).filter_by(palace_id=1).count()

        dedupe_response = self.client.post("/api/v1/palaces/1/quiz-questions/dedupe")
        with self.SessionLocal() as session:
            count_after_dedupe = session.query(PalaceQuizQuestion).filter_by(palace_id=1).count()

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(count_after_list, 3)
        self.assertEqual(dedupe_response.status_code, 200)
        self.assertEqual(dedupe_response.json()["deduped_count"], 1)
        with self.SessionLocal() as session:
            active_count_after_dedupe = (
                session.query(PalaceQuizQuestion)
                .filter_by(palace_id=1, deleted_at=None)
                .count()
            )
        self.assertEqual(count_after_dedupe, 3)
        self.assertEqual(active_count_after_dedupe, 2)

    def test_batch_create_and_multiple_choice_validation(self):
        response = self.client.post(
            "/api/v1/palaces/1/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "question_type": "multiple_choice",
                        "stem": "光合作用场所是？",
                        "options": [
                            {"id": "A", "text": "叶绿体"},
                            {"id": "B", "text": "液泡"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "叶绿体是光合作用的场所。",
                    },
                    {
                        "question_type": "short_answer",
                        "stem": "什么是同源染色体？",
                        "answer_payload": {"reference_answer": "形态大小相似的一对染色体。"},
                        "analysis": "注意来源于父母双方。",
                    },
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["sort_order"], 3)
        self.assertEqual(items[1]["sort_order"], 4)

        invalid_response = self.client.post(
            "/api/v1/palaces/1/quiz-questions",
            json={
                "question_type": "multiple_choice",
                "stem": "错误题",
                "options": [{"id": "A", "text": "只有一个"}],
                "answer_payload": {"correct_option_id": "A"},
            },
        )
        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn("至少需要 2 个选项", invalid_response.json()["detail"])

    def test_batch_create_auto_deduplicates_questions(self):
        response = self.client.post(
            "/api/v1/palaces/1/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "question_type": "multiple_choice",
                        "stem": " 细胞的控制中心是？ ",
                        "options": [
                            {"id": "A", "text": "细胞膜"},
                            {"id": "B", "text": "细胞核"},
                        ],
                        "answer_payload": {"correct_option_id": "B"},
                        "analysis": "细胞核控制细胞活动。",
                    },
                    {
                        "question_type": "multiple_choice",
                        "stem": "光合作用场所是？",
                        "options": [
                            {"id": "A", "text": "叶绿体"},
                            {"id": "B", "text": "液泡"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "叶绿体是光合作用的场所。",
                    },
                    {
                        "question_type": "multiple_choice",
                        "stem": "光合作用场所是？",
                        "options": [
                            {"id": "A", "text": "叶绿体"},
                            {"id": "B", "text": "液泡"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "叶绿体是光合作用的场所。",
                    },
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["stem"], "光合作用场所是？")

        list_response = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertEqual(list_response.status_code, 200)
        stems = [item["stem"] for item in list_response.json()["items"]]
        self.assertEqual(stems.count("细胞的控制中心是？"), 1)
        self.assertEqual(stems.count("光合作用场所是？"), 1)

    def test_batch_create_import_dedup_normalizes_quotes_without_dropping_exam_label(self):
        with self.SessionLocal() as session:
            session.add(
                PalaceQuizQuestion(
                    source_chapter_id=self.chapter_id,
                    question_type="multiple_choice",
                    stem="【2011年311真题28】主张教育目的是‘为完满生活做准备’，反对英国古典主义教育传统的教育家是（）",
                    options_json=json.dumps(
                        [
                            {"id": "A", "text": "斯宾塞"},
                            {"id": "B", "text": "洛克"},
                        ],
                        ensure_ascii=False,
                    ),
                    answer_payload_json=json.dumps(
                        {"correct_option_id": "A"},
                        ensure_ascii=False,
                    ),
                    analysis="已有题。",
                    source_meta_json=json.dumps({"source_kind": "manual"}, ensure_ascii=False),
                    sort_order=1,
                )
            )
            session.commit()

        response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "question_type": "multiple_choice",
                        "stem": "【2011年311真题28】主张教育目的是“为完满生活做准备”，反对英国古典主义教育传统的教育家是()",
                        "options": [
                            {"id": "A", "text": "斯宾塞"},
                            {"id": "B", "text": "洛克"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "解析不同也应按导入口径去重。",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [])

    def test_batch_create_import_dedup_keeps_exam_label_as_identity(self):
        with self.SessionLocal() as session:
            session.add(
                PalaceQuizQuestion(
                    source_chapter_id=self.chapter_id,
                    question_type="multiple_choice",
                    stem="主张教育目的是“为完满生活做准备”，反对英国古典主义教育传统的教育家是()",
                    options_json=json.dumps(
                        [
                            {"id": "A", "text": "斯宾塞"},
                            {"id": "B", "text": "洛克"},
                        ],
                        ensure_ascii=False,
                    ),
                    answer_payload_json=json.dumps(
                        {"correct_option_id": "A"},
                        ensure_ascii=False,
                    ),
                    analysis="已有题。",
                    source_meta_json=json.dumps({"source_kind": "manual"}, ensure_ascii=False),
                    sort_order=1,
                )
            )
            session.commit()

        response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "question_type": "multiple_choice",
                        "stem": "【2011年311真题28】主张教育目的是“为完满生活做准备”，反对英国古典主义教育传统的教育家是()",
                        "options": [
                            {"id": "A", "text": "斯宾塞"},
                            {"id": "B", "text": "洛克"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "带真题标签时应视作独立题目。",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["items"]), 1)

    def test_batch_delete_questions(self):
        with self.SessionLocal() as session:
            ids = [
                item.id
                for item in session.query(PalaceQuizQuestion)
                .filter(PalaceQuizQuestion.palace_id == 1)
                .order_by(PalaceQuizQuestion.id.asc())
                .all()
            ]

        response = self.client.post(
            "/api/v1/palace-quiz-questions/batch-delete",
            json={"question_ids": ids[:2]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["deleted_count"], 2)

        listed = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"], [])

    def test_chapter_question_listing_auto_deduplicates_existing_duplicates(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    PalaceQuizQuestion(
                        palace_id=None,
                        mini_palace_id=None,
                        source_chapter_id=self.chapter_id,
                        classified_chapter_id=None,
                        question_type="multiple_choice",
                        stem="叶绿体的作用是？",
                        options_json=json.dumps(
                            [
                                {"id": "A", "text": "进行光合作用"},
                                {"id": "B", "text": "控制细胞活动"},
                            ],
                            ensure_ascii=False,
                        ),
                        answer_payload_json=json.dumps(
                            {"correct_option_id": "A"},
                            ensure_ascii=False,
                        ),
                        analysis="叶绿体负责光合作用。",
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
                        sort_order=1,
                    ),
                    PalaceQuizQuestion(
                        palace_id=None,
                        mini_palace_id=None,
                        source_chapter_id=self.chapter_id,
                        classified_chapter_id=None,
                        question_type="multiple_choice",
                        stem=" 叶绿体的作用是？ ",
                        options_json=json.dumps(
                            [
                                {"id": "A", "text": "进行光合作用"},
                                {"id": "B", "text": "控制细胞活动"},
                            ],
                            ensure_ascii=False,
                        ),
                        answer_payload_json=json.dumps(
                            {"correct_option_id": "A"},
                            ensure_ascii=False,
                        ),
                        analysis="叶绿体负责光合作用。",
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
                        sort_order=2,
                    ),
                ]
            )
            session.commit()

        listed = self.client.get(f"/api/v1/chapters/{self.chapter_id}/quiz-questions")
        self.assertEqual(listed.status_code, 200)
        stems = [item["stem"] for item in listed.json()["items"]]
        self.assertEqual(stems.count("叶绿体的作用是？"), 1)

        with self.SessionLocal() as session:
            remaining = (
                session.query(PalaceQuizQuestion)
                .filter(PalaceQuizQuestion.source_chapter_id == self.chapter_id)
                .all()
            )
            remaining_stems = [item.stem for item in remaining]
        self.assertEqual(remaining_stems.count("叶绿体的作用是？"), 1)

    def test_batch_create_accepts_game_question_types(self):
        response = self.client.post(
            "/api/v1/palaces/1/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "question_type": "true_false",
                        "stem": "细胞核控制细胞活动。",
                        "answer_payload": {
                            "correct_answer": True,
                            "false_explanation": "细胞核是控制中心。",
                        },
                        "analysis": "判断核心概念。",
                    },
                    {
                        "question_type": "fill_blank",
                        "stem": "细胞的控制中心是 {{blank_1}}。",
                        "answer_payload": {
                            "blanks": [
                                {"id": "blank_1", "answer": "细胞核", "aliases": ["核"]}
                            ]
                        },
                        "analysis": "填核心术语。",
                    },
                    {
                        "question_type": "matching",
                        "stem": "完成结构与功能连线。",
                        "answer_payload": {
                            "pairs": [
                                {
                                    "left_id": "L1",
                                    "left": "细胞核",
                                    "right_id": "R1",
                                    "right": "控制细胞活动",
                                },
                                {
                                    "left_id": "L2",
                                    "left": "细胞膜",
                                    "right_id": "R2",
                                    "right": "控制物质进出",
                                },
                            ]
                        },
                        "analysis": "结构功能对应。",
                    },
                    {
                        "question_type": "ordering",
                        "stem": "按有丝分裂阶段排序。",
                        "answer_payload": {
                            "items": [
                                {"id": "I1", "text": "前期"},
                                {"id": "I2", "text": "中期"},
                            ],
                            "correct_order_ids": ["I1", "I2"],
                        },
                        "analysis": "考查顺序。",
                    },
                    {
                        "question_type": "categorization",
                        "stem": "把概念归类。",
                        "answer_payload": {
                            "categories": [
                                {"id": "C1", "name": "结构"},
                                {"id": "C2", "name": "过程"},
                            ],
                            "items": [
                                {"id": "T1", "text": "细胞核", "category_id": "C1"},
                                {"id": "T2", "text": "有丝分裂", "category_id": "C2"},
                            ],
                        },
                        "analysis": "考查归类。",
                    },
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(
            [item["question_type"] for item in items],
            ["true_false", "fill_blank", "matching", "ordering", "categorization"],
        )
        self.assertTrue(items[0]["answer_payload"]["correct_answer"])

    def test_create_question_rolls_back_when_mutation_response_fails(self):
        with self.SessionLocal() as session:
            before_count = session.query(PalaceQuizQuestion).count()

        client = TestClient(self.app, raise_server_exceptions=False)
        with patch.object(
            palace_quiz_router.SqlAlchemyMutationResponseStore,
            "save",
            side_effect=RuntimeError("mutation response failed"),
        ):
            response = client.post(
                "/api/v1/palaces/1/quiz-questions",
                headers={MUTATION_ID_HEADER: "quiz-create-rollback"},
                json={
                    "question_type": "multiple_choice",
                    "stem": "新的原子题目？",
                    "options": [
                        {"id": "A", "text": "甲"},
                        {"id": "B", "text": "乙"},
                    ],
                    "answer_payload": {"correct_option_id": "A"},
                    "analysis": "测试",
                },
            )

        self.assertEqual(response.status_code, 500)
        with self.SessionLocal() as session:
            self.assertEqual(session.query(PalaceQuizQuestion).count(), before_count)

    def test_choice_attempt_rolls_back_when_mutation_response_fails(self):
        with self.SessionLocal() as session:
            question = session.get(PalaceQuizQuestion, 1)
            before = (
                question.attempt_count,
                question.correct_count,
                question.incorrect_count,
            )

        client = TestClient(self.app, raise_server_exceptions=False)
        with patch.object(
            palace_quiz_router.SqlAlchemyMutationResponseStore,
            "save",
            side_effect=RuntimeError("mutation response failed"),
        ):
            response = client.post(
                "/api/v1/palace-quiz-questions/1/choice-attempts",
                headers={MUTATION_ID_HEADER: "quiz-choice-rollback"},
                json={"selected_option_id": "B"},
            )

        self.assertEqual(response.status_code, 500)
        with self.SessionLocal() as session:
            question = session.get(PalaceQuizQuestion, 1)
            self.assertEqual(
                (
                    question.attempt_count,
                    question.correct_count,
                    question.incorrect_count,
                ),
                before,
            )

    def test_palace_batch_replays_first_mutation_response(self):
        headers = {MUTATION_ID_HEADER: "quiz-palace-batch-replay"}
        first = self.client.post(
            "/api/v1/palaces/1/quiz-questions/batch",
            headers=headers,
            json={
                "questions": [
                    {
                        "question_type": "short_answer",
                        "stem": "首次重放题",
                        "answer_payload": {"reference_answer": "首次答案"},
                        "analysis": "首次解析",
                    }
                ],
                "ocr_sources": [
                    {
                        "source_kind": "text_files",
                        "source_set": "text_files",
                        "page_key": "replay_first",
                        "page_number": 1,
                        "image_path": "first.txt",
                        "raw_text": "首次 OCR",
                        "lines": [],
                        "source_meta": {},
                        "import_batch": "replay-first",
                    }
                ],
            },
        )
        second = self.client.post(
            "/api/v1/palaces/1/quiz-questions/batch",
            headers=headers,
            json={
                "questions": [
                    {
                        "question_type": "short_answer",
                        "stem": "第二次不应保存",
                        "answer_payload": {"reference_answer": "第二次答案"},
                        "analysis": "第二次解析",
                    }
                ],
                "ocr_sources": [
                    {
                        "source_kind": "text_files",
                        "source_set": "text_files",
                        "page_key": "replay_second",
                        "page_number": 2,
                        "image_path": "second.txt",
                        "raw_text": "第二次 OCR",
                        "lines": [],
                        "source_meta": {},
                        "import_batch": "replay-second",
                    }
                ],
            },
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json(), first.json())
        with self.SessionLocal() as session:
            self.assertEqual(
                session.query(PalaceQuizQuestion)
                .filter(PalaceQuizQuestion.stem == "首次重放题")
                .count(),
                1,
            )
            self.assertEqual(
                session.query(PalaceQuizQuestion)
                .filter(PalaceQuizQuestion.stem == "第二次不应保存")
                .count(),
                0,
            )
            self.assertEqual(session.query(PalaceQuizOcrSource).count(), 0)

    def test_choice_attempts_only_update_multiple_choice_statistics(self):
        correct_response = self.client.post(
            "/api/v1/palace-quiz-questions/1/choice-attempts",
            json={"selected_option_id": "B"},
        )
        self.assertEqual(correct_response.status_code, 200)
        self.assertTrue(correct_response.json()["is_correct"])
        self.assertEqual(correct_response.json()["question"]["correct_count"], 1)
        self.assertEqual(correct_response.json()["question"]["attempt_count"], 1)

        incorrect_response = self.client.post(
            "/api/v1/palace-quiz-questions/1/choice-attempts",
            json={"selected_option_id": "A"},
        )
        self.assertEqual(incorrect_response.status_code, 200)
        self.assertFalse(incorrect_response.json()["is_correct"])
        self.assertEqual(incorrect_response.json()["question"]["correct_count"], 1)
        self.assertEqual(incorrect_response.json()["question"]["incorrect_count"], 1)
        self.assertEqual(incorrect_response.json()["question"]["attempt_count"], 2)

        short_answer_response = self.client.post(
            "/api/v1/palace-quiz-questions/2/choice-attempts",
            json={"selected_option_id": "A"},
        )
        self.assertEqual(short_answer_response.status_code, 400)
        self.assertIn("只有选择题可以累计对错统计", short_answer_response.json()["detail"])

    def test_mark_toggle_does_not_write_a_review_schedule(self):
        from datetime import date

        with self.SessionLocal() as session:
            question = session.get(PalaceQuizQuestion, 1)
            assert question is not None
            question.schedule_stage = 1
            question.schedule_due_on = date(2026, 9, 20)
            question.schedule_passed = True
            session.commit()

        marked = self.client.post(
            "/api/v1/palace-quiz-questions/1/mark",
            json={"marked": True},
        )
        self.assertEqual(marked.status_code, 200)
        item = marked.json()["item"]
        self.assertTrue(item["marked"])
        self.assertEqual(item["schedule_stage"], 1)
        self.assertEqual(item["schedule_due_on"], "2026-09-20")
        self.assertTrue(item["schedule_passed"])

        cleared = self.client.post(
            "/api/v1/palace-quiz-questions/1/mark",
            json={"marked": False},
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertFalse(cleared.json()["item"]["marked"])

        rejected = self.client.post(
            "/api/v1/palace-quiz-questions/1/mark",
            json={"marked": 1},
        )
        self.assertEqual(rejected.status_code, 400)

    def test_reset_question_attempt_statistics(self):
        self.client.post(
            "/api/v1/palace-quiz-questions/1/choice-attempts",
            json={"selected_option_id": "B"},
        )
        self.client.post(
            "/api/v1/palace-quiz-questions/1/choice-attempts",
            json={"selected_option_id": "A"},
        )

        reset_response = self.client.post(
            "/api/v1/palace-quiz-questions/reset-attempts",
            json={"question_ids": [1, 2]},
        )
        self.assertEqual(reset_response.status_code, 200)
        self.assertTrue(reset_response.json()["ok"])
        self.assertEqual(reset_response.json()["reset_count"], 2)

        listed = self.client.get("/api/v1/palaces/1/quiz-questions")
        question = listed.json()["items"][0]
        self.assertEqual(question["attempt_count"], 0)
        self.assertEqual(question["correct_count"], 0)
        self.assertEqual(question["incorrect_count"], 0)

        invalid_response = self.client.post(
            "/api/v1/palace-quiz-questions/reset-attempts",
            json={"question_ids": []},
        )
        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn("至少需要选择一题", invalid_response.json()["detail"])


    def test_can_batch_create_and_list_chapter_quiz_questions(self):
        response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "classified_chapter_id": self.child_chapter_id,
                        "question_type": "multiple_choice",
                        "stem": "细胞核的主要作用是？",
                        "options": [
                            {"id": "A", "text": "控制细胞活动"},
                            {"id": "B", "text": "合成蛋白质"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "细胞核负责调控。 ",
                        "source_meta": {
                            "source_kind": "chapter_outline",
                            "generation_mode": "chapter_outline_grouped",
                        },
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        created = response.json()["items"]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["source_chapter_id"], self.chapter_id)
        self.assertEqual(created[0]["classified_chapter_id"], self.child_chapter_id)
        self.assertIsNone(created[0]["palace_id"])

        listed = self.client.get(f"/api/v1/chapters/{self.chapter_id}/quiz-questions")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 1)
        self.assertEqual(listed.json()["items"][0]["classified_chapter"]["id"], self.child_chapter_id)

        aggregated = self.client.get("/api/v1/palaces/1/aggregated-quiz-questions")
        self.assertEqual(aggregated.status_code, 200)
        matched = [
            item
            for item in aggregated.json()["items"]
            if item["source_chapter_id"] == self.chapter_id
            and item["classified_chapter_id"] == self.child_chapter_id
        ]
        self.assertEqual(len(matched), 1)

    def test_batch_create_chapter_quiz_questions_forces_selected_chapter_scope(self):
        response = self.client.post(
            f"/api/v1/chapters/{self.child_chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "question_type": "multiple_choice",
                        "stem": "AI 错标父章节的题？",
                        "options": [
                            {"id": "A", "text": "父章节"},
                            {"id": "B", "text": "当前章节"},
                        ],
                        "answer_payload": {"correct_option_id": "B"},
                        "analysis": "保存时必须以用户选择的章节为准。",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        created = response.json()["items"]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["source_chapter_id"], self.child_chapter_id)

        child_listed = self.client.get(f"/api/v1/chapters/{self.child_chapter_id}/quiz-questions")
        self.assertEqual(child_listed.status_code, 200)
        self.assertEqual(
            [item["stem"] for item in child_listed.json()["items"]],
            ["AI 错标父章节的题？"],
        )

        parent_listed = self.client.get(f"/api/v1/chapters/{self.chapter_id}/quiz-questions")
        self.assertEqual(parent_listed.status_code, 200)
        self.assertFalse(
            any(item["stem"] == "AI 错标父章节的题？" for item in parent_listed.json()["items"])
        )

    def test_batch_create_chapter_quiz_questions_can_overwrite_selected_scope(self):
        first_response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "question_type": "multiple_choice",
                        "stem": "旧题 A？",
                        "options": [
                            {"id": "A", "text": "旧选项A"},
                            {"id": "B", "text": "旧选项B"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "旧解析。",
                    },
                    {
                        "source_chapter_id": self.chapter_id,
                        "question_type": "short_answer",
                        "stem": "旧题 B？",
                        "answer_payload": {"reference_answer": "旧答案"},
                        "analysis": "旧解析。",
                    },
                ]
            },
        )
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(len(first_response.json()["items"]), 2)

        overwrite_response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "save_mode": "overwrite",
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "classified_chapter_id": self.child_chapter_id,
                        "question_type": "multiple_choice",
                        "stem": "新题？",
                        "options": [
                            {"id": "A", "text": "新选项A"},
                            {"id": "B", "text": "新选项B"},
                        ],
                        "answer_payload": {"correct_option_id": "B"},
                        "analysis": "新解析。",
                    }
                ],
            },
        )
        self.assertEqual(overwrite_response.status_code, 200)
        created = overwrite_response.json()["items"]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["sort_order"], 1)

        listed = self.client.get(f"/api/v1/chapters/{self.chapter_id}/quiz-questions")
        stems = [item["stem"] for item in listed.json()["items"]]
        self.assertEqual(stems, ["新题？"])

    def test_batch_create_chapter_quiz_questions_rejects_segment_binding(self):
        response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "classified_chapter_id": self.child_chapter_id,
                        "segment_ids": [1],
                        "question_type": "multiple_choice",
                        "stem": "细胞核的主要作用是？",
                        "options": [
                            {"id": "A", "text": "控制细胞活动"},
                            {"id": "B", "text": "合成蛋白质"},
                        ],
                        "answer_payload": {"correct_option_id": "A"},
                        "analysis": "细胞核负责调控。",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("章节题暂不支持绑定学习组", response.json()["detail"])

    def test_palace_aggregated_questions_include_bound_chapter_questions(self):
        with self.SessionLocal() as session:
            session.add(
                PalaceQuizQuestion(
                    palace_id=None,
                    source_chapter_id=self.chapter_id,
                    classified_chapter_id=self.child_chapter_id,
                    question_type="short_answer",
                    stem="概述细胞核作用。",
                    options_json="[]",
                    answer_payload_json=json.dumps({"reference_answer": "控制细胞活动。"}, ensure_ascii=False),
                    analysis="围绕调控作用回答。",
                    source_meta_json=json.dumps(
                        {"source_kind": "chapter_outline", "generation_mode": "chapter_outline_grouped"},
                        ensure_ascii=False,
                    ),
                    sort_order=1,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/aggregated-quiz-questions")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertTrue(any(item["source_chapter_id"] == self.chapter_id for item in items))

    def test_palace_aggregated_questions_deduplicates_dual_owned_rows(self):
        with self.SessionLocal() as session:
            session.add(
                PalaceQuizQuestion(
                    palace_id=1,
                    source_chapter_id=self.chapter_id,
                    question_type="short_answer",
                    stem="同时属于宫殿和章节的题。",
                    options_json="[]",
                    answer_payload_json=json.dumps(
                        {"reference_answer": "只应返回一次。"},
                        ensure_ascii=False,
                    ),
                    analysis="聚合接口应按题目 id 去重。",
                    source_meta_json=json.dumps({"source_kind": "manual"}, ensure_ascii=False),
                    sort_order=99,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/aggregated-quiz-questions")
        self.assertEqual(response.status_code, 200)
        matched = [
            item
            for item in response.json()["items"]
            if item["stem"] == "同时属于宫殿和章节的题。"
        ]
        self.assertEqual(len(matched), 1)

    def test_palace_aggregated_questions_include_parent_scoped_questions_classified_to_bound_child(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            set_palace_chapter_links(session, palace, [self.chapter_id, self.child_chapter_id])
            reconcile_palace_chapter_binding(
                session,
                palace,
                preferred_primary_chapter_id=self.child_chapter_id,
            )
            session.add(
                PalaceQuizQuestion(
                    palace_id=None,
                    source_chapter_id=self.chapter_id,
                    classified_chapter_id=self.child_chapter_id,
                    question_type="short_answer",
                    stem="概述细胞核作用。",
                    options_json="[]",
                    answer_payload_json=json.dumps({"reference_answer": "控制细胞活动。"}, ensure_ascii=False),
                    analysis="围绕调控作用回答。",
                    source_meta_json=json.dumps(
                        {"source_kind": "chapter_outline", "generation_mode": "chapter_outline_grouped"},
                        ensure_ascii=False,
                    ),
                    sort_order=1,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/1/aggregated-quiz-questions")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        matched = [
            item
            for item in items
            if item["source_chapter_id"] == self.chapter_id
            and item["classified_chapter_id"] == self.child_chapter_id
        ]
        self.assertEqual(len(matched), 1)

    def test_palace_aggregated_questions_exclude_parent_scoped_questions_for_sibling_child_palace(self):
        with self.SessionLocal() as session:
            sibling_child = Chapter(
                subject_id=1,
                parent_id=self.chapter_id,
                name="细胞膜",
                sort_order=1,
            )
            session.add(sibling_child)
            session.flush()
            sibling_palace = session.query(Palace).filter_by(id=2).first()
            self.assertIsNotNone(sibling_palace)
            set_palace_chapter_links(session, sibling_palace, [self.chapter_id, sibling_child.id])
            reconcile_palace_chapter_binding(
                session,
                sibling_palace,
                preferred_primary_chapter_id=sibling_child.id,
            )
            session.add(
                PalaceQuizQuestion(
                    palace_id=None,
                    source_chapter_id=self.chapter_id,
                    classified_chapter_id=self.child_chapter_id,
                    question_type="short_answer",
                    stem="概述细胞核作用。",
                    options_json="[]",
                    answer_payload_json=json.dumps({"reference_answer": "控制细胞活动。"}, ensure_ascii=False),
                    analysis="围绕调控作用回答。",
                    source_meta_json=json.dumps(
                        {"source_kind": "chapter_outline", "generation_mode": "chapter_outline_grouped"},
                        ensure_ascii=False,
                    ),
                    sort_order=1,
                )
            )
            session.commit()

        response = self.client.get("/api/v1/palaces/2/aggregated-quiz-questions")
        self.assertEqual(response.status_code, 200)
        matched = [
            item
            for item in response.json()["items"]
            if item["source_chapter_id"] == self.chapter_id
            and item["classified_chapter_id"] == self.child_chapter_id
        ]
        self.assertEqual(matched, [])


if __name__ == "__main__":
    unittest.main()
