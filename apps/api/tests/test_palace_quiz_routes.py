import json
import unittest
from unittest.mock import patch

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog
from memory_anki.infrastructure.db._tables.palaces import (
    FreestyleQuizAttempt,
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
)
from memory_anki.modules.palace_quiz.application import ai_service as palace_quiz_ai_service
from memory_anki.modules.palace_quiz.presentation import router as palace_quiz_router
from memory_anki.modules.palaces.application.title_sync_service import (
    reconcile_palace_chapter_binding,
    set_palace_chapter_links,
)
from memory_anki.modules.settings.application.ai_prompt_templates import (
    PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT,
)
from memory_anki.modules.settings.presentation import router as settings_router
from support import RouterTestCase

PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT = PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT


def build_palace_quiz_pdf_pairing_prompt(extra_prompt: str) -> str:
    return f"{PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT}\n{extra_prompt}"


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
                name="细胞核专项训练",
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

    def test_pdf_pairing_prompt_requires_candidate_coverage(self):
        prompt = build_palace_quiz_pdf_pairing_prompt("只要第四节的")

        self.assertIn("逐条检查 question_candidates", prompt)
        self.assertIn("模拟练习", prompt)
        self.assertIn("论述题", prompt)
        self.assertIn("skipped_reasons", prompt)
        self.assertIn("missing_answer_candidate", prompt)
        self.assertIn("最终 questions 数量应等于范围内可配对 question_candidates 数量", prompt)
        self.assertIn("范围判断不能只依赖候选里的 section 字段", prompt)
        self.assertIn("out_of_scope", prompt)
        self.assertIn("答案/解析必须解释同一道题的核心关键词", prompt)
        self.assertIn("answer_conflict", prompt)

    def test_pdf_transcription_prompt_preserves_visible_section_boundaries(self):
        prompt = PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT

        self.assertIn("section 只能来自该题附近或本页上方真实可见的栏目标题", prompt)
        self.assertIn("禁止为了迎合用户补充范围", prompt)
        self.assertIn("previous_page_continuation", prompt)

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

    def test_short_answer_feedback_builds_expected_model_input(self):
        captured: dict[str, object] = {}

        def fake_call_logged_chat_completion(**kwargs):
            captured.update(kwargs)
            return ("你的答案已经抓住核心，但还可以补充遗传稳定性。", "log-short")

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palace-quiz-questions/2/short-answer-feedback",
                json={"user_answer": "可以保证细胞正常分裂。"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-short")
        self.assertIn("抓住核心", payload["feedback_text"])
        self.assertIsNone(payload["verdict"])
        self.assertEqual(payload["hit_points"], [])
        self.assertEqual(payload["missed_points"], [])
        self.assertEqual(payload["suggestion"], "")
        self.assertIsNone(captured["response_format"])
        self.assertEqual(
            captured["request_payload"]["model_input"],
            {
                "stem": "简述有丝分裂的意义。",
                "user_answer": "可以保证细胞正常分裂。",
                "reference_answer": "保证遗传信息稳定传递。",
                "analysis": "核心在于遗传物质平均分配。",
            },
        )

    def test_short_answer_feedback_returns_structured_fields(self):
        def fake_call_logged_chat_completion(**kwargs):
            self.assertIsNone(kwargs["response_format"])
            return (
                json.dumps(
                    {
                        "verdict": "partial",
                        "hit_points": ["答到了细胞分裂相关"],
                        "missed_points": ["遗漏遗传信息稳定传递"],
                        "suggestion": "补一句遗传物质平均分配的意义。",
                    },
                    ensure_ascii=False,
                ),
                "log-structured",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palace-quiz-questions/2/short-answer-feedback",
                json={"user_answer": "可以保证细胞正常分裂。"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-structured")
        self.assertEqual(payload["verdict"], "partial")
        self.assertEqual(payload["hit_points"], ["答到了细胞分裂相关"])
        self.assertEqual(payload["missed_points"], ["遗漏遗传信息稳定传递"])
        self.assertEqual(payload["suggestion"], "补一句遗传物质平均分配的意义。")
        self.assertIn("答到的要点", payload["feedback_text"])
        self.assertIn("遗漏或有偏差", payload["feedback_text"])

    def test_short_answer_feedback_falls_back_to_plain_text(self):
        def fake_call_logged_chat_completion(**kwargs):
            self.assertIsNone(kwargs["response_format"])
            return ("你的答案方向正确，建议补充遗传稳定性。", "log-plain")

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palace-quiz-questions/2/short-answer-feedback",
                json={"user_answer": "可以保证细胞正常分裂。"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["feedback_text"], "你的答案方向正确，建议补充遗传稳定性。")
        self.assertIsNone(payload["verdict"])
        self.assertEqual(payload["hit_points"], [])
        self.assertEqual(payload["missed_points"], [])
        self.assertEqual(payload["suggestion"], "")

    def test_question_explain_builds_expected_model_input(self):
        captured: dict[str, object] = {}

        def fake_call_logged_chat_completion(**kwargs):
            captured.update(kwargs)
            return ("正确答案是细胞核，因为它控制细胞生命活动。", "log-explain")

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palace-quiz-questions/1/explain",
                json={"user_question": "为什么选 B？"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["question_id"], 1)
        self.assertEqual(payload["ai_call_log_id"], "log-explain")
        self.assertIn("细胞核", payload["explanation_text"])
        self.assertEqual(captured["operation"], "palace_quiz_question_explain")
        self.assertEqual(captured["request_payload"]["user_question"], "为什么选 B？")
        self.assertEqual(
            captured["request_payload"]["model_input"],
            {
                "question_id": 1,
                "question_type": "multiple_choice",
                "stem": "细胞的控制中心是？",
                "options": [
                    {"id": "A", "text": "细胞膜"},
                    {"id": "B", "text": "细胞核"},
                ],
                "answer_payload": {"correct_option_id": "B"},
                "analysis": "细胞核控制细胞活动。",
                "palace_title": "Quiz Palace",
                "mini_palace_name": None,
                "source_chapter_name": None,
            },
        )

    def test_pdf_generation_endpoint_passes_document_pages_and_extra_prompt(self):
        captured: dict[str, object] = {}

        def fake_call_logged_chat_completion(**kwargs):
            captured.update(kwargs)
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "蛋白质的基本单位是什么？",
                                "options": [
                                    {"id": "A", "text": "葡萄糖"},
                                    {"id": "B", "text": "氨基酸"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "蛋白质由氨基酸脱水缩合形成。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-pdf",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[
                    (3, b"page-3", "page-3.png"),
                    (4, b"page-4", "page-4.png"),
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3, 4],
                    "extra_prompt": "优先抽取原题",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-pdf")
        self.assertEqual(payload["source_meta"]["subject_document_id"], 1)
        self.assertEqual(payload["source_meta"]["page_numbers"], [3, 4])
        self.assertEqual(payload["source_meta"]["extra_prompt"], "优先抽取原题")
        self.assertEqual(len(payload["questions"]), 1)
        self.assertEqual(payload["questions"][0]["question_type"], "multiple_choice")
        self.assertEqual(len(captured["image_items"]), 2)
        self.assertEqual(
            captured["request_payload"]["source_meta"]["page_numbers"],
            [3, 4],
        )

    def test_pdf_generation_endpoint_accepts_multiple_pdf_sources(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "short_answer",
                                "stem": "根据两份资料整合本题答案。",
                                "reference_answer": "整合后的参考答案。",
                                "analysis": "综合题目册与答案册内容。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-multi-pdf",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                side_effect=[
                    [(1, b"question-1", "question-1.png")],
                    [(2, b"answer-2", "answer-2.png")],
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "pdf_sources": [
                        {
                            "subject_document_id": 1,
                            "page_selection": [1],
                            "role_hint": "题目册",
                        },
                        {
                            "subject_document_id": 1,
                            "page_selection": [2],
                            "role_hint": "答案册",
                        },
                    ],
                    "extra_prompt": "自动整合题目与答案",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-multi-pdf")
        self.assertEqual(payload["source_meta"]["generation_mode"], "subject_pdf_multi")
        self.assertEqual(len(payload["source_meta"]["pdf_sources"]), 2)
        self.assertEqual(payload["source_meta"]["pdf_sources"][0]["role_hint"], "question")
        self.assertEqual(payload["source_meta"]["pdf_sources"][1]["role_hint"], "answer")
        self.assertFalse(payload["source_meta"]["secondary_review_enabled"])
        self.assertIn("资料来源清单", calls[0]["request_payload"]["source_context"])
        self.assertEqual(len(calls[0]["image_items"]), 2)
        self.assertEqual(calls[1]["operation"], "palace_quiz_pair_pdf_with_turbo")
        self.assertEqual(payload["generation_stats"]["returned_count"], 1)
        self.assertNotIn("英国教育", calls[1]["request_payload"]["prompt"])

    def test_pdf_generation_defaults_to_palace_primary_chapter(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            set_palace_chapter_links(session, palace, [self.child_chapter_id])
            reconcile_palace_chapter_binding(
                session,
                palace,
                preferred_primary_chapter_id=self.child_chapter_id,
            )
            session.commit()

        def fake_call_logged_chat_completion(**kwargs):
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "short_answer",
                                    "stem": "请概括该页核心内容。",
                                    "reference_answer": "核心内容概括。",
                                    "analysis": "围绕主概念整理即可。",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-pdf-primary-chapter",
                )
            raise AssertionError("single-source PDF should not call pairing")

        with (
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(1, b"page", "page-1.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [1],
                    "extra_prompt": "",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["source_chapter_id"], self.child_chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.child_chapter_id)

    def test_pdf_generation_multi_source_request_binds_each_image_to_a_role(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "question_candidates": [
                                {
                                    "section": "第三章",
                                    "number": "1",
                                    "stem": "主观题题面",
                                    "raw_type_label": "论述题",
                                    "source_snippet": "第三章 二、论述题 主观题题面",
                                }
                            ],
                            "answer_candidates": [
                                {
                                    "section": "第三章",
                                    "number": "1",
                                    "raw_type_label": "论述题",
                                    "reference_answer": "参考答案",
                                    "analysis": "解析",
                                    "raw_answer_text": "参考答案",
                                }
                            ],
                        },
                        ensure_ascii=False,
                    ),
                    "log-generate-role-map",
                )
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "short_answer",
                                "stem": "主观题题面",
                                "reference_answer": "参考答案",
                                "analysis": "解析",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-pair-role-map",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key", create=True),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                side_effect=[
                    [(10, b"question-10", "question-10.png"), (11, b"question-11", "question-11.png")],
                    [(9, b"answer-9", "answer-9.png"), (10, b"answer-10", "answer-10.png")],
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "pdf_sources": [
                        {"subject_document_id": 1, "page_selection": [10, 11], "role_hint": "question"},
                        {"subject_document_id": 1, "page_selection": [9, 10], "role_hint": "answer"},
                    ],
                    "extra_prompt": "",
                },
            )

        self.assertEqual(response.status_code, 200)
        source_context = calls[0]["request_payload"]["source_context"]
        first_user_text = calls[0]["messages"][-1]["content"][0]["text"]
        second_user_text = calls[0]["messages"][-1]["content"][2]["text"]
        self.assertIn("图片顺序与角色绑定", source_context)
        self.assertIn("第 1 张图片 = demo.pdf 第 10 页；角色：题目来源", source_context)
        self.assertIn("第 3 张图片 = demo.pdf 第 9 页；角色：答案与解析来源", source_context)
        self.assertIn("只允许抄录到 question_candidates", source_context)
        self.assertIn("只允许抄录到 answer_candidates", source_context)
        self.assertIn("必须严格遵守每张图片绑定的角色", first_user_text)
        self.assertIn("每张图片只能写入它在上方“图片顺序与角色绑定”里指定的候选池", second_user_text)

    def test_pdf_generation_multi_source_subjective_candidates_return_short_answer(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "question_candidates": [
                                {
                                    "section": "第三章西欧中世纪的教育",
                                    "number": "1",
                                    "stem": "【2007年311真题22】西欧中世纪的骑士教育是一种特殊形式的（）",
                                    "raw_type_label": "单项选择题",
                                    "source_snippet": "单项选择题 1",
                                    "options": [
                                        {"id": "A", "text": "学校教育"},
                                        {"id": "B", "text": "家庭教育"},
                                    ],
                                },
                                {
                                    "section": "第三章西欧中世纪的教育",
                                    "number": "二、论述题 1",
                                    "stem": "试述中世纪大学的产生及其在教育史上的地位与作用。",
                                    "raw_type_label": "论述题",
                                    "source_snippet": "二、论述题 1. 试述中世纪大学的产生及其在教育史上的地位与作用。",
                                },
                            ],
                            "answer_candidates": [
                                {
                                    "section": "第三章西欧中世纪的教育",
                                    "number": "1",
                                    "raw_type_label": "单项选择题",
                                    "correct_option_id": "B",
                                    "analysis": "骑士教育是一种特殊的家庭教育。",
                                    "raw_answer_text": "[答案]B",
                                },
                                {
                                    "section": "第三章西欧中世纪的教育",
                                    "number": "二、论述题 1",
                                    "raw_type_label": "论述题",
                                    "reference_answer": "社会经济发展推动了中世纪大学产生，并在高等教育史上具有直接渊源地位。",
                                    "analysis": "答案需覆盖产生背景与教育史意义。",
                                    "raw_answer_text": "[参考答案] 社会经济发展推动了中世纪大学产生，并在高等教育史上具有直接渊源地位。",
                                },
                            ],
                        },
                        ensure_ascii=False,
                    ),
                    "log-generate-subjective",
                )
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "【2007年311真题22】西欧中世纪的骑士教育是一种特殊形式的（）",
                                "options": [
                                    {"id": "A", "text": "学校教育"},
                                    {"id": "B", "text": "家庭教育"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "骑士教育是一种特殊的家庭教育。",
                            },
                            {
                                "question_type": "short_answer",
                                "stem": "试述中世纪大学的产生及其在教育史上的地位与作用。",
                                "reference_answer": "社会经济发展推动了中世纪大学产生，并在高等教育史上具有直接渊源地位。",
                                "analysis": "答案需覆盖产生背景与教育史意义。",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-pair-subjective",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key", create=True),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                side_effect=[
                    [(10, b"question-10", "question-10.png"), (11, b"question-11", "question-11.png")],
                    [(9, b"answer-9", "answer-9.png"), (10, b"answer-10", "answer-10.png")],
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "pdf_sources": [
                        {"subject_document_id": 1, "page_selection": [10, 11], "role_hint": "question"},
                        {"subject_document_id": 1, "page_selection": [9, 10], "role_hint": "answer"},
                    ],
                    "extra_prompt": "",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([item["question_type"] for item in payload["questions"]], ["multiple_choice", "short_answer"])
        self.assertEqual(payload["questions"][1]["answer_payload"]["reference_answer"], "社会经济发展推动了中世纪大学产生，并在高等教育史上具有直接渊源地位。")
        self.assertEqual(payload["generation_stats"]["returned_count"], 2)
        self.assertEqual(payload["generation_stats"]["savable_count"], 2)

    def test_pdf_generation_secondary_review_is_controlled_by_explicit_flag(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "第四节中的关键法令是什么？",
                                    "options": [
                                        {"id": "A", "text": "法令甲"},
                                        {"id": "B", "text": "法令乙"},
                                    ],
                                    "correct_option_id": "A",
                                    "analysis": "根据资料整理。",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-generate",
                )
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "第四节中的关键法令是什么？",
                                "options": [
                                    {"id": "A", "text": "法令甲"},
                                    {"id": "B", "text": "法令乙"},
                                ],
                                "correct_option_id": "A",
                                "analysis": "复核后保留。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-review",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            disabled_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "只要第四节的",
                    "enable_secondary_review": False,
                },
            )
            enabled_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "只要第四节的",
                    "enable_secondary_review": True,
                },
            )

        self.assertEqual(disabled_response.status_code, 200)
        self.assertEqual(enabled_response.status_code, 200)
        disabled_calls = [item for item in calls[:1]]
        enabled_calls = calls[1:]
        self.assertEqual(len(disabled_calls), 1)
        self.assertEqual(disabled_calls[0]["operation"], "palace_quiz_generate_pdf")
        self.assertEqual(len(enabled_calls), 2)
        self.assertEqual(enabled_calls[0]["operation"], "palace_quiz_generate_pdf")
        self.assertEqual(enabled_calls[1]["operation"], "palace_quiz_review_pdf_with_turbo")
        self.assertNotIn("英国教育", enabled_calls[1]["request_payload"]["prompt"])
        self.assertNotIn("第斯多惠", enabled_calls[1]["request_payload"]["prompt"])
        self.assertFalse(disabled_response.json()["source_meta"]["secondary_review_enabled"])
        self.assertTrue(enabled_response.json()["source_meta"]["secondary_review_enabled"])

    def test_pdf_generation_skips_invalid_correct_option_and_returns_warning(self):
        def fake_call_logged_chat_completion(**kwargs):
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "蛋白质的基本单位是什么？",
                                "options": [
                                    {"id": "A", "text": "葡萄糖"},
                                    {"id": "B", "text": "氨基酸"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "蛋白质由氨基酸组成。",
                            },
                            {
                                "question_type": "multiple_choice",
                                "stem": "无效题",
                                "options": [
                                    {"id": "A", "text": "甲"},
                                    {"id": "B", "text": "乙"},
                                ],
                                "correct_option_id": "不存在的答案",
                                "analysis": "无法匹配。",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-invalid",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={"subject_document_id": 1, "page_selection": [3]},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["questions"]), 1)
        self.assertEqual(payload["questions"][0]["answer_payload"]["correct_option_id"], "B")
        self.assertGreaterEqual(len(payload["warnings"]), 1)
        self.assertTrue(any("已跳过" in warning for warning in payload["warnings"]))

    def test_pdf_generation_skips_suspicious_option_ids_without_rewriting_ai_content(self):
        def fake_call_logged_chat_completion(**kwargs):
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "洛克强调哪种教育？",
                                "options": [
                                    {"id": "A", "text": "神学教育"},
                                    {"id": "B", "text": "家庭教育"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "洛克重视家庭教育。",
                            },
                            {
                                "question_type": "multiple_choice",
                                "stem": "异常选项编号题",
                                "options": [
                                    {"id": "A", "text": "神学教育"},
                                    {"id": "text", "text": "家庭教育"},
                                    {"id": "id", "text": "骑士教育"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "洛克重视家庭教育。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-option-normalize",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={"subject_document_id": 1, "page_selection": [3]},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["questions"]), 1)
        self.assertTrue(any("已跳过" in warning for warning in payload["warnings"]))

    def test_review_mindmap_generation_uses_cross_palace_first_multi_node_summary(self):
        captured: dict[str, object] = {}

        def fake_call_logged_chat_completion(**kwargs):
            captured.update(kwargs)
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "true_false",
                                "stem": "细胞核和分支A存在可用于联想的结构关系。",
                                "correct_answer": True,
                                "false_explanation": "本题为正确判断。",
                                "analysis": "用于验证跨宫殿关联题。",
                            },
                            {
                                "question_type": "fill_blank",
                                "stem": "当前章节的核心节点是 {{blank_1}}。",
                                "blanks": [
                                    {
                                        "id": "blank_1",
                                        "answer": "细胞核",
                                        "aliases": [],
                                    }
                                ],
                                "analysis": "用于验证填空题归一化。",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-review-mindmap",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/review-mindmap",
                json={
                    "mode": "cross_palace",
                    "question_types": ["true_false", "fill_blank"],
                    "question_count": 2,
                    "review_editor_doc": {
                        "root": {
                            "data": {"text": "当前复习", "uid": "review-root"},
                            "children": [
                                {
                                    "data": {"text": "细胞核", "uid": "cell-core"},
                                    "children": [],
                                }
                            ],
                        }
                    },
                    "related_palace_ids": [2],
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-review-mindmap")
        self.assertEqual(payload["source_meta"]["source_kind"], "review_mindmap")
        self.assertEqual(payload["source_meta"]["generation_mode"], "review_cross_palace")
        self.assertEqual(payload["source_meta"]["question_types"], ["true_false", "fill_blank"])
        self.assertEqual(payload["source_meta"]["related_palace_ids"], [2])
        self.assertEqual(
            captured["request_payload"]["model_input"]["related_palaces"][0]["first_multi_nodes"],
            ["分支A", "分支B"],
        )
        self.assertEqual(
            [item["question_type"] for item in payload["questions"]],
            ["true_false", "fill_blank"],
        )

    def test_pdf_generation_stream_emits_status_delta_and_result(self):
        def fake_stream_chat_completion_text(**kwargs):
            yield '{"questions":'
            yield '[{"question_type":"short_answer","stem":"概括本节关键变化。","reference_answer":"本节关键变化体现为制度逐步调整。","analysis":"结合题目册和解析册整理。"}]}'
            return '{"questions":[{"question_type":"short_answer","stem":"概括本节关键变化。","reference_answer":"本节关键变化体现为制度逐步调整。","analysis":"结合题目册和解析册整理。"}]}'

        def fake_pairing_chat_completion(**kwargs):
            return (
                '{"questions":[{"question_type":"short_answer","stem":"概括本节关键变化。","reference_answer":"本节关键变化体现为制度逐步调整。","analysis":"Turbo 已配对题目册和解析册。"}]}',
                "log-pair",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                side_effect=[
                    [(15, b"question-15", "question-15.png")],
                    [(15, b"answer-15", "answer-15.png")],
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "stream_chat_completion_text",
                side_effect=fake_stream_chat_completion_text,
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_pairing_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/stream",
                json={
                    "pdf_sources": [
                        {"subject_document_id": 1, "page_selection": [15], "role_hint": "question"},
                        {"subject_document_id": 1, "page_selection": [15], "role_hint": "answer"},
                    ],
                    "extra_prompt": "只要第四节的",
                },
            )

        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn("event: status", body)
        self.assertIn("event: delta", body)
        self.assertIn("event: result", body)
        self.assertIn("正在用 Turbo 配对题目与答案", body)
        self.assertIn("概括本节关键变化", body)
        self.assertIn("log-pair", body)

    def test_pdf_generation_stream_emits_review_status_only_when_enabled(self):
        def fake_stream_chat_completion_text(**kwargs):
            if False:
                yield ""
            return '{"questions":[{"question_type":"short_answer","stem":"概括本节要点。","reference_answer":"要点一。","analysis":"原始结果。"}]}'

        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            return (
                '{"questions":[{"question_type":"short_answer","stem":"概括本节要点。","reference_answer":"要点一。","analysis":"复核结果。"}]}',
                "log-review",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(15, b"page-15", "page-15.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "stream_chat_completion_text",
                side_effect=fake_stream_chat_completion_text,
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            disabled_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/stream",
                json={
                    "subject_document_id": 1,
                    "page_selection": [15],
                    "extra_prompt": "只要第四节的",
                    "enable_secondary_review": False,
                },
            )
            enabled_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/stream",
                json={
                    "subject_document_id": 1,
                    "page_selection": [15],
                    "extra_prompt": "只要第四节的",
                    "enable_secondary_review": True,
                },
            )

        self.assertNotIn("正在复核题目范围", disabled_response.text)
        self.assertIn("正在复核题目范围", enabled_response.text)
        self.assertEqual(calls[-1]["operation"], "palace_quiz_review_pdf_with_turbo")

    def test_pdf_generation_can_override_generation_and_pairing_models_separately(self):
        build_calls: list[dict[str, object]] = []

        def fake_build_chat_config(session, *, scenario_key, ai_options, temperature, timeout_seconds):
            build_calls.append(
                {
                    "scenario_key": scenario_key,
                    "ai_options": ai_options,
                    "temperature": temperature,
                    "timeout_seconds": timeout_seconds,
                }
            )
            return (
                object(),
                None,
                {
                    "scene_key": scenario_key,
                    "scene_label": scenario_key,
                    "model_key": ai_options.model if ai_options and ai_options.model else f"{scenario_key}-default",
                    "model_label": ai_options.model if ai_options and ai_options.model else f"{scenario_key}-default",
                    "provider": "qwen",
                    "provider_label": "Qwen",
                    "model_type": "vl" if scenario_key == "quiz_pdf_generation" else "llm",
                    "model_type_label": "VL" if scenario_key == "quiz_pdf_generation" else "大语言",
                    "has_vision": scenario_key == "quiz_pdf_generation",
                    "thinking_enabled": bool(ai_options.thinking_enabled) if ai_options else False,
                },
            )

        def fake_call_logged_chat_completion(**kwargs):
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "question_candidates": [
                                {
                                    "section": "第四节",
                                    "number": "1",
                                    "stem": "第四节真题 1",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                }
                            ],
                            "answer_candidates": [
                                {
                                    "section": "第四节",
                                    "number": "1",
                                    "correct_option_id": "B",
                                    "analysis": "解析1",
                                }
                            ],
                        },
                        ensure_ascii=False,
                    ),
                    "log-generate",
                )
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "第四节真题 1",
                                "options": [
                                    {"id": "A", "text": "选项A"},
                                    {"id": "B", "text": "选项B"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "解析1",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-pair",
            )

        with (
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                side_effect=[
                    [(41, b"question-41", "question-41.png")],
                    [(59, b"answer-59", "answer-59.png")],
                ],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_build_chat_config",
                side_effect=fake_build_chat_config,
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "pdf_sources": [
                        {"subject_document_id": 1, "page_selection": [41], "role_hint": "question"},
                        {"subject_document_id": 1, "page_selection": [59], "role_hint": "answer"},
                    ],
                    "extra_prompt": "只要第四节的",
                    "ai_options_by_scenario": {
                        "quiz_pdf_generation": {"model": "glm-4.6v-flash", "thinking_enabled": True},
                        "quiz_pdf_pairing": {"model": "qwen-max", "thinking_enabled": False},
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "log-pair")
        self.assertEqual(payload["resolved_ai_steps"]["generation"]["model_key"], "glm-4.6v-flash")
        self.assertEqual(payload["resolved_ai_steps"]["pairing"]["model_key"], "qwen-max")
        self.assertEqual(build_calls[0]["scenario_key"], "quiz_pdf_generation")
        self.assertEqual(build_calls[0]["ai_options"].model, "glm-4.6v-flash")
        self.assertEqual(build_calls[1]["scenario_key"], "quiz_pdf_pairing")
        self.assertEqual(build_calls[1]["ai_options"].model, "qwen-max")

    def test_pdf_generation_recover_endpoint_reuses_existing_pairing_input(self):
        request_payload = {
            "messages": [
                {"role": "system", "content": "system prompt"},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "source_context": "资料来源清单：1. 题目册；2. 答案册",
                            "vision_draft": json.dumps(
                                {
                                    "question_candidates": [
                                        {"section": "第四节", "number": "1", "stem": "第四节真题 1", "options": [{"id": "A", "text": "选项A"}, {"id": "B", "text": "选项B"}]},
                                        {"section": "模拟练习", "number": "1", "stem": "第四节模拟 1", "options": [{"id": "A", "text": "选项A"}, {"id": "B", "text": "选项B"}]},
                                    ],
                                    "answer_candidates": [
                                        {"section": "第四节", "number": "1", "correct_option_id": "A", "analysis": "解析1"},
                                        {"section": "模拟练习", "number": "1", "correct_option_id": "B", "analysis": "解析2"},
                                    ],
                                },
                                ensure_ascii=False,
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "source_meta": {
                "source_kind": "subject_pdf",
                "generation_mode": "subject_pdf_multi",
                "extra_prompt": "只要第四节的",
                "subject_document_id": 1,
                "page_numbers": [41, 42, 59, 60],
                "image_names": ["page-41.png", "page-42.png", "page-59.png", "page-60.png"],
                "pdf_sources": [
                    {"subject_document_id": 1, "document_name": "questions.pdf", "page_numbers": [41, 42], "role_hint": "question"},
                    {"subject_document_id": 1, "document_name": "answers.pdf", "page_numbers": [59, 60], "role_hint": "answer"},
                ],
            },
        }

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch(
                "memory_anki.modules.palace_quiz.application.quiz_generation_service.get_external_ai_call_log",
                return_value={"request_payload": request_payload, "response_payload": {"response_text": "{}"}},
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                return_value=(
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "第四节真题 1",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                    "correct_option_id": "A",
                                    "analysis": "解析1",
                                },
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "第四节模拟 1",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                    "correct_option_id": "B",
                                    "analysis": "解析2",
                                },
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-recover-pair",
                ),
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/recover",
                json={"ai_call_log_id": "0f7c1913217e4d419fefcacfb941d351"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["ai_call_log_id"], "0f7c1913217e4d419fefcacfb941d351")
        self.assertEqual(len(payload["questions"]), 2)
        self.assertFalse(payload["source_meta"]["secondary_review_enabled"])
        self.assertEqual(
            payload["source_meta"]["recovered_from_ai_call_log_id"],
            "0f7c1913217e4d419fefcacfb941d351",
        )

    def test_pdf_generation_recover_and_save_endpoint_writes_chapter_questions(self):
        source_log_id = "recover-save-source-log"
        request_payload = {
            "messages": [
                {"role": "system", "content": "system prompt"},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "source_context": "资料来源清单：1. 题目册；2. 答案册",
                            "vision_draft": json.dumps(
                                {
                                    "question_candidates": [
                                        {
                                            "section": "细胞核",
                                            "number": "1",
                                            "stem": "题目 1",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        },
                                        {
                                            "section": "细胞核",
                                            "number": "2",
                                            "stem": "题目 2",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        },
                                        {
                                            "section": "细胞核",
                                            "number": "3",
                                            "stem": "缺答案题",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        },
                                        {
                                            "section": "模拟练习",
                                            "number": "4",
                                            "stem": "简答题",
                                            "raw_type_label": "论述题",
                                            "source_snippet": "二、论述题 简答题",
                                        },
                                    ],
                                    "answer_candidates": [
                                        {"section": "细胞核", "number": "1", "correct_option_id": "A", "analysis": "解析1"},
                                        {"section": "细胞核", "number": "2", "correct_option_id": "B", "analysis": "解析2"},
                                        {"section": "模拟练习", "number": "4", "raw_type_label": "论述题", "reference_answer": "参考答案4", "analysis": "解析4", "raw_answer_text": "参考答案4"},
                                    ],
                                },
                                ensure_ascii=False,
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "source_meta": {
                "source_kind": "subject_pdf",
                "generation_mode": "subject_pdf_multi",
                "extra_prompt": "",
                "subject_document_id": 1,
                "page_numbers": [3],
                "image_names": ["page-3.png"],
                "pdf_sources": [
                    {"subject_document_id": 1, "document_name": "questions.pdf", "page_numbers": [3], "role_hint": "question"},
                    {"subject_document_id": 1, "document_name": "answers.pdf", "page_numbers": [5], "role_hint": "answer"},
                ],
                "source_chapter_id": self.chapter_id,
            },
        }

        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id=source_log_id,
                    feature="宫殿做题",
                    operation="palace_quiz_pair_pdf_with_turbo",
                    palace_id=1,
                    status="success",
                    provider="openai_compatible",
                    base_url="https://example.com",
                    model="qwen",
                    request_id="",
                    request_json=json.dumps(request_payload, ensure_ascii=False),
                    response_json=json.dumps({"response_text": "{}"}, ensure_ascii=False),
                    error_json="{}",
                )
            )
            session.add(
                PalaceQuizQuestion(
                    palace_id=None,
                    source_chapter_id=self.chapter_id,
                    question_type="short_answer",
                    stem="覆盖前旧题",
                    options_json="[]",
                    answer_payload_json=json.dumps(
                        {"reference_answer": "旧答案"},
                        ensure_ascii=False,
                    ),
                    analysis="旧解析。",
                    source_meta_json=json.dumps(
                        {"source_kind": "manual", "generation_mode": "manual"},
                        ensure_ascii=False,
                    ),
                    sort_order=1,
                )
            )
            session.commit()

        with (
            patch(
                "memory_anki.modules.palace_quiz.application.quiz_generation_service.get_external_ai_call_log",
                return_value={"request_payload": request_payload, "response_payload": {"response_text": "{}"}},
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                return_value=(
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "题目 1",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                    "correct_option_id": "A",
                                    "analysis": "解析1",
                                },
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "题目 2",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                    "correct_option_id": "B",
                                    "analysis": "解析2",
                                },
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "recover-save-pair-log",
                ),
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/recover-and-save",
                json={
                    "ai_call_log_id": source_log_id,
                    "selected_chapter_id": self.chapter_id,
                    "classify_by_mini_palace": True,
                    "save_mode": "overwrite",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recovered_count"], 2)
        self.assertEqual(payload["saved_count"], 2)
        self.assertEqual(payload["deduped_count"], 0)
        self.assertEqual(payload["grouped_summary"][0]["classified_chapter_id"], self.child_chapter_id)
        skipped_codes = {item["code"] for item in payload["skipped_reasons"]}
        self.assertEqual(
            skipped_codes,
            {"missing_answer_candidate", "unsupported_final_question_type"},
        )

        listed = self.client.get(f"/api/v1/chapters/{self.chapter_id}/quiz-questions")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 2)
        self.assertTrue(
            all(
                item["classified_chapter_id"] == self.child_chapter_id
                for item in listed.json()["items"]
            )
        )

        aggregated = self.client.get("/api/v1/palaces/1/aggregated-quiz-questions")
        self.assertEqual(aggregated.status_code, 200)
        matched = [
            item
            for item in aggregated.json()["items"]
            if item["source_chapter_id"] == self.chapter_id
            and item["classified_chapter_id"] == self.child_chapter_id
        ]
        self.assertEqual(len(matched), 2)

    def test_pdf_generation_recover_and_save_endpoint_dedupes_repeated_import(self):
        source_log_id = "recover-dedupe-source-log"
        request_payload = {
            "messages": [
                {"role": "system", "content": "system prompt"},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "source_context": "资料来源清单：1. 题目册；2. 答案册",
                            "vision_draft": json.dumps(
                                {
                                    "question_candidates": [
                                        {
                                            "section": "第一节",
                                            "number": "1",
                                            "stem": "题目 1",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        },
                                        {
                                            "section": "第一节",
                                            "number": "2",
                                            "stem": "题目 2",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        },
                                    ],
                                    "answer_candidates": [
                                        {"section": "第一节", "number": "1", "correct_option_id": "A", "analysis": "解析1"},
                                        {"section": "第一节", "number": "2", "correct_option_id": "B", "analysis": "解析2"},
                                    ],
                                },
                                ensure_ascii=False,
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "source_meta": {
                "source_kind": "subject_pdf",
                "generation_mode": "subject_pdf_multi",
                "extra_prompt": "",
                "subject_document_id": 1,
                "page_numbers": [3],
                "image_names": ["page-3.png"],
                "pdf_sources": [],
                "source_chapter_id": self.chapter_id,
            },
        }
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id=source_log_id,
                    feature="宫殿做题",
                    operation="palace_quiz_pair_pdf_with_turbo",
                    palace_id=1,
                    status="success",
                    provider="openai_compatible",
                    base_url="https://example.com",
                    model="qwen",
                    request_id="",
                    request_json=json.dumps(request_payload, ensure_ascii=False),
                    response_json=json.dumps({"response_text": "{}"}, ensure_ascii=False),
                    error_json="{}",
                )
            )
            session.commit()

        with patch(
            "memory_anki.modules.palace_quiz.application.quiz_generation_service.get_external_ai_call_log",
            return_value={"request_payload": request_payload, "response_payload": {"response_text": "{}"}},
        ), patch.object(
            palace_quiz_ai_service,
            "_call_logged_chat_completion",
            return_value=(
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "multiple_choice",
                                "stem": "题目 1",
                                "options": [
                                    {"id": "A", "text": "选项A"},
                                    {"id": "B", "text": "选项B"},
                                ],
                                "correct_option_id": "A",
                                "analysis": "解析1",
                            },
                            {
                                "question_type": "multiple_choice",
                                "stem": "题目 2",
                                "options": [
                                    {"id": "A", "text": "选项A"},
                                    {"id": "B", "text": "选项B"},
                                ],
                                "correct_option_id": "B",
                                "analysis": "解析2",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                "recover-dedupe-pair-log",
            ),
        ):
            first = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/recover-and-save",
                json={
                    "ai_call_log_id": source_log_id,
                    "selected_chapter_id": self.chapter_id,
                    "classify_by_mini_palace": False,
                },
            )
            second = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/recover-and-save",
                json={
                    "ai_call_log_id": source_log_id,
                    "selected_chapter_id": self.chapter_id,
                    "classify_by_mini_palace": False,
                },
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["saved_count"], 2)
        self.assertEqual(second.json()["saved_count"], 0)
        self.assertEqual(second.json()["deduped_count"], 2)

    def test_pdf_generation_recover_and_save_endpoint_classifies_to_deep_descendant_by_vl_marker(self):
        source_log_id = "recover-deep-scope-log"
        with self.SessionLocal() as session:
            deep_parent = Chapter(
                subject_id=1,
                parent_id=self.chapter_id,
                name="单链入口",
                sort_order=2,
            )
            session.add(deep_parent)
            session.flush()
            deep_child = Chapter(
                subject_id=1,
                parent_id=deep_parent.id,
                name="第四节 深层小节",
                sort_order=0,
            )
            session.add(deep_child)
            session.commit()
            deep_parent_id = deep_parent.id
            deep_child_id = deep_child.id

        request_payload = {
            "messages": [
                {"role": "system", "content": "system prompt"},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "source_context": "资料来源清单：1. 题目册；2. 答案册",
                            "vision_draft": json.dumps(
                                {
                                    "question_candidates": [
                                        {
                                            "section": "第四节",
                                            "number": "1",
                                            "stem": "题目 1",
                                            "options": [
                                                {"id": "A", "text": "选项A"},
                                                {"id": "B", "text": "选项B"},
                                            ],
                                        }
                                    ],
                                    "answer_candidates": [
                                        {"section": "第四节", "number": "1", "correct_option_id": "A", "analysis": "解析1"}
                                    ],
                                },
                                ensure_ascii=False,
                            ),
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "source_meta": {
                "source_kind": "subject_pdf",
                "generation_mode": "subject_pdf_multi",
                "extra_prompt": "",
                "subject_document_id": 1,
                "page_numbers": [3],
                "image_names": ["page-3.png"],
                "pdf_sources": [],
                "source_chapter_id": deep_parent_id,
            },
        }
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id=source_log_id,
                    feature="宫殿做题",
                    operation="palace_quiz_pair_pdf_with_turbo",
                    palace_id=1,
                    status="success",
                    provider="openai_compatible",
                    base_url="https://example.com",
                    model="qwen",
                    request_id="",
                    request_json=json.dumps(request_payload, ensure_ascii=False),
                    response_json=json.dumps({"response_text": "{}"}, ensure_ascii=False),
                    error_json="{}",
                )
            )
            session.commit()

        with (
            patch(
                "memory_anki.modules.palace_quiz.application.quiz_generation_service.get_external_ai_call_log",
                return_value={"request_payload": request_payload, "response_payload": {"response_text": "{}"}},
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                return_value=(
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "题目 1",
                                    "options": [
                                        {"id": "A", "text": "选项A"},
                                        {"id": "B", "text": "选项B"},
                                    ],
                                    "correct_option_id": "A",
                                    "analysis": "解析1",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "recover-deep-scope-pair-log",
                ),
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf/recover-and-save",
                json={
                    "ai_call_log_id": source_log_id,
                    "selected_chapter_id": deep_parent_id,
                    "classify_by_mini_palace": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["grouped_summary"][0]["classified_chapter_id"], deep_child_id)

    def test_image_generation_endpoint_handles_single_and_multi_upload(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "short_answer",
                                "stem": "请概括该页核心内容。",
                                "reference_answer": "核心内容概括。",
                                "analysis": "围绕主概念整理即可。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                f"log-{len(calls)}",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            single_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/images",
                data={"extra_prompt": "先识别现成题目"},
                files=[("files", ("single.png", b"one", "image/png"))],
            )
            multi_response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/images",
                data={"extra_prompt": ""},
                files=[
                    ("files", ("a.png", b"a", "image/png")),
                    ("files", ("b.png", b"b", "image/png")),
                ],
            )

        self.assertEqual(single_response.status_code, 200)
        self.assertEqual(
            single_response.json()["source_meta"]["generation_mode"],
            "single_image",
        )
        self.assertEqual(
            single_response.json()["source_meta"]["image_names"],
            ["single.png"],
        )

        self.assertEqual(multi_response.status_code, 200)
        self.assertEqual(
            multi_response.json()["source_meta"]["generation_mode"],
            "multi_image",
        )
        self.assertEqual(
            multi_response.json()["source_meta"]["image_names"],
            ["a.png", "b.png"],
        )
        self.assertEqual(len(calls[0]["image_items"]), 1)
        self.assertEqual(len(calls[1]["image_items"]), 2)

    def test_image_generation_accepts_selected_chapter_and_writes_source_chapter(self):
        def fake_call_logged_chat_completion(**kwargs):
            return (
                json.dumps(
                    {
                        "questions": [
                            {
                                "question_type": "short_answer",
                                "stem": "请概括该页核心内容。",
                                "reference_answer": "核心内容概括。",
                                "analysis": "围绕主概念整理即可。",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                "log-selected-chapter",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/images",
                data={
                    "extra_prompt": "只要本章",
                    "selected_chapter_id": str(self.chapter_id),
                },
                files=[("files", ("single.png", b"one", "image/png"))],
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["source_chapter_id"], self.chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)

    def test_text_file_generation_reads_standard_json_without_ai(self):
        with patch.object(
            palace_quiz_ai_service,
            "_call_logged_chat_completion",
            side_effect=AssertionError("standard JSON should not call AI"),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/text-files",
                data={"extra_prompt": "", "selected_chapter_id": str(self.chapter_id)},
                files=[
                    (
                        "files",
                        (
                            "questions.json",
                            json.dumps(
                                {
                                    "questions": [
                                        {
                                            "question_type": "fill_blank",
                                            "stem": "DNA 的基本单位是 {{blank_1}}。",
                                            "blanks": [
                                                {
                                                    "id": "blank_1",
                                                    "answer": "核苷酸",
                                                    "aliases": ["脱氧核苷酸"],
                                                }
                                            ],
                                            "analysis": "资料明确指出 DNA 由核苷酸组成。",
                                        }
                                    ]
                                },
                                ensure_ascii=False,
                            ).encode("utf-8"),
                            "application/json",
                        ),
                    )
                ],
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["generation_mode"], "text_files")
        self.assertEqual(payload["questions"][0]["question_type"], "fill_blank")
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)

    def test_text_file_generation_pairs_textbook_questions_and_answers(self):
        question_text = "\n".join(
            [
                "第一章 细胞生物学",
                "第一节 细胞结构",
                "真题典例",
                "单项选择题",
                "1. 细胞遗传信息主要储存在（）",
                "A. 细胞膜",
                "B. 细胞核",
                "C. 核糖体",
                "D. 细胞壁",
                "二、论述题",
                "1. 简述有丝分裂的生物学意义。",
            ]
        )
        answer_text = "\n".join(
            [
                "第一章 细胞生物学",
                "第一节 细胞结构",
                "真题典例",
                "单项选择题",
                "1.【答案】B 细胞核保存主要遗传信息。",
                "二、论述题",
                "1.【参考答案】保证遗传信息稳定传递，并维持亲子代细胞遗传稳定。",
            ]
        )

        with patch.object(
            palace_quiz_ai_service,
            "_call_logged_chat_completion",
            side_effect=AssertionError("paired textbook text should not call AI"),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/text-files",
                data={"extra_prompt": "", "selected_chapter_id": str(self.chapter_id)},
                files=[
                    ("files", ("bio_questions.txt", question_text.encode("utf-8"), "text/plain")),
                    ("files", ("bio_answers.txt", answer_text.encode("utf-8"), "text/plain")),
                ],
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["questions"]), 2)
        self.assertEqual(payload["questions"][0]["question_type"], "multiple_choice")
        self.assertEqual(payload["questions"][0]["answer_payload"]["correct_option_id"], "B")
        self.assertEqual(payload["questions"][1]["question_type"], "short_answer")
        self.assertIn("遗传信息稳定传递", payload["questions"][1]["answer_payload"]["reference_answer"])

    def test_text_file_generation_global_dedupes_by_stem_and_options(self):
        response = self.client.post(
            "/api/v1/palaces/1/quiz-generation/text-files",
            data={"extra_prompt": "", "selected_chapter_id": str(self.chapter_id)},
            files=[
                (
                    "files",
                    (
                        "duplicate.json",
                        json.dumps(
                            {
                                "questions": [
                                    {
                                        "question_type": "multiple_choice",
                                        "stem": "细胞的控制中心是？",
                                        "options": [
                                            {"id": "A", "text": "细胞膜"},
                                            {"id": "B", "text": "细胞核"},
                                        ],
                                        "correct_option_id": "B",
                                        "analysis": "解析文字即使不同也应按导入口径去重。",
                                    },
                                    {
                                        "question_type": "short_answer",
                                        "stem": "说明细胞核的作用。",
                                        "reference_answer": "储存遗传信息并控制细胞活动。",
                                        "analysis": "细胞核是控制中心。",
                                    },
                                ]
                            },
                            ensure_ascii=False,
                        ).encode("utf-8"),
                        "application/json",
                    ),
                )
            ],
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["questions"]), 1)
        self.assertEqual(payload["questions"][0]["stem"], "说明细胞核的作用。")
        self.assertEqual(payload["generation_stats"]["skipped_count"], 1)

    def test_image_generation_accepts_parent_chapter_when_only_child_is_explicitly_bound(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            set_palace_chapter_links(session, palace, [self.child_chapter_id])
            reconcile_palace_chapter_binding(
                session,
                palace,
                preferred_primary_chapter_id=self.child_chapter_id,
            )
            session.commit()

        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_images":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "short_answer",
                                    "stem": "请概括该页核心内容。",
                                    "reference_answer": "核心内容概括。",
                                    "analysis": "围绕主概念整理即可。",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-selected-parent-image",
                )
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": self.child_chapter_id, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [],
                    },
                    ensure_ascii=False,
                ),
                "log-selected-parent-image-group",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/images",
                data={
                    "extra_prompt": "只要本章",
                    "classify_by_mini_palace": "true",
                    "selected_chapter_id": str(self.chapter_id),
                },
                files=[("files", ("single.png", b"one", "image/png"))],
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["source_chapter_id"], self.chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)
        self.assertEqual(
            payload["grouped_questions"]["child_chapter_groups"][0]["classified_chapter_id"],
            self.child_chapter_id,
        )
        self.assertEqual(calls[1]["operation"], "palace_quiz_group_by_child_chapter")

    def test_classify_existing_quiz_questions_to_mini_palaces_is_idempotent(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": 1, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [1],
                    },
                    ensure_ascii=False,
                ),
                "log-classify",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            first_response = self.client.post(
                "/api/v1/palaces/1/quiz-classification/mini-palaces"
            )
            second_response = self.client.post(
                "/api/v1/palaces/1/quiz-classification/mini-palaces"
            )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(first_response.json()["copied_question_count"], 1)
        listed = self.client.get("/api/v1/palaces/1/quiz-questions")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 3)
        copied_questions = [
            item for item in listed.json()["items"] if item["mini_palace_id"] == 1
        ]
        self.assertEqual(len(copied_questions), 1)
        self.assertEqual(copied_questions[0]["origin_question_id"], 1)
        self.assertEqual(calls[0]["messages"][0]["content"], calls[1]["messages"][0]["content"])

    def test_pdf_generation_can_return_grouped_questions_by_mini_palace(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "细胞的控制中心是？",
                                    "options": [
                                        {"id": "A", "text": "细胞膜"},
                                        {"id": "B", "text": "细胞核"},
                                    ],
                                    "correct_option_id": "B",
                                    "analysis": "细胞核控制细胞活动。",
                                },
                                {
                                    "question_type": "short_answer",
                                    "stem": "概括本页重点。",
                                    "reference_answer": "围绕分裂过程概括。",
                                    "analysis": "抓主线即可。",
                                },
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-pdf",
                )
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": 1, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [1],
                    },
                    ensure_ascii=False,
                ),
                "log-group",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "",
                    "classify_by_mini_palace": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["questions"]), 2)
        self.assertEqual(
            payload["grouped_questions"]["mini_palace_groups"][0]["mini_palace_id"],
            1,
        )
        self.assertEqual(
            len(payload["grouped_questions"]["mini_palace_groups"][0]["questions"]),
            1,
        )
        self.assertEqual(
            len(payload["grouped_questions"]["unassigned_questions"]),
            1,
        )
        self.assertEqual(calls[1]["operation"], "ai_prompt_palace_quiz_group_by_mini_palace")

    def test_pdf_generation_can_return_grouped_questions_by_child_chapter_when_selected(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "细胞的控制中心是？",
                                    "options": [
                                        {"id": "A", "text": "细胞膜"},
                                        {"id": "B", "text": "细胞核"},
                                    ],
                                    "correct_option_id": "B",
                                    "analysis": "细胞核控制细胞活动。",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-pdf",
                )
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": self.child_chapter_id, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [],
                    },
                    ensure_ascii=False,
                ),
                "log-group-child",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "",
                    "classify_by_mini_palace": True,
                    "selected_chapter_id": self.chapter_id,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["source_chapter_id"], self.chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)
        self.assertEqual(
            payload["grouped_questions"]["child_chapter_groups"][0]["classified_chapter_id"],
            self.child_chapter_id,
        )
        self.assertEqual(calls[1]["operation"], "palace_quiz_group_by_child_chapter")

    def test_pdf_generation_accepts_parent_chapter_when_only_child_is_explicitly_bound(self):
        with self.SessionLocal() as session:
            palace = session.query(Palace).filter_by(id=1).first()
            self.assertIsNotNone(palace)
            set_palace_chapter_links(session, palace, [self.child_chapter_id])
            reconcile_palace_chapter_binding(
                session,
                palace,
                preferred_primary_chapter_id=self.child_chapter_id,
            )
            session.commit()

        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "palace_quiz_generate_pdf":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "细胞的控制中心是？",
                                    "options": [
                                        {"id": "A", "text": "细胞膜"},
                                        {"id": "B", "text": "细胞核"},
                                    ],
                                    "correct_option_id": "B",
                                    "analysis": "细胞核控制细胞活动。",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-pdf-parent",
                )
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": self.child_chapter_id, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [],
                    },
                    ensure_ascii=False,
                ),
                "log-group-parent",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "render_selected_pdf_pages",
                return_value=[(3, b"page-3", "page-3.png")],
            ),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "",
                    "classify_by_mini_palace": True,
                    "selected_chapter_id": self.chapter_id,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source_meta"]["source_chapter_id"], self.chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)
        self.assertEqual(
            payload["grouped_questions"]["child_chapter_groups"][0]["classified_chapter_id"],
            self.child_chapter_id,
        )
        self.assertEqual(calls[1]["operation"], "palace_quiz_group_by_child_chapter")

    def test_pdf_generation_rejects_selected_chapter_outside_palace_scope(self):
        with patch.object(
            palace_quiz_ai_service,
            "render_selected_pdf_pages",
            return_value=[(3, b"page-3", "page-3.png")],
        ):
            response = self.client.post(
                "/api/v1/palaces/1/quiz-generation/pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [3],
                    "extra_prompt": "",
                    "selected_chapter_id": self.unrelated_chapter_id,
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("不在当前宫殿已绑定的章节范围内", response.json()["detail"])

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

    def test_batch_create_chapter_quiz_questions_rejects_mini_palace_binding(self):
        response = self.client.post(
            f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch",
            json={
                "questions": [
                    {
                        "source_chapter_id": self.chapter_id,
                        "classified_chapter_id": self.child_chapter_id,
                        "mini_palace_id": 1,
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
        self.assertIn("章节题暂不支持绑定专项训练", response.json()["detail"])

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

    def test_palace_quiz_ocr_sources_can_be_listed_and_are_palace_scoped(self):
        payload = {
            "questions": [
                {
                    "question_type": "multiple_choice",
                    "stem": "带 OCR 来源的题？",
                    "options": [
                        {"id": "A", "text": "是"},
                        {"id": "B", "text": "否"},
                    ],
                    "answer_payload": {"correct_option_id": "A"},
                    "analysis": "用于测试 OCR 来源落库。",
                    "source_meta": {
                        "source_kind": "text_files",
                        "ocr_source_refs": [
                            {"source_set": "text_files", "page_key": "source_001"}
                        ],
                    },
                }
            ],
            "ocr_sources": [
                {
                    "source_kind": "text_files",
                    "source_set": "text_files",
                    "page_key": "source_001",
                    "page_number": 1,
                    "image_path": "source.txt",
                    "raw_text": "原始 OCR 文本",
                    "lines": [{"text": "原始 OCR 文本"}],
                    "source_meta": {"filename": "source.txt"},
                    "import_batch": "test-batch",
                }
            ],
        }

        create_response = self.client.post("/api/v1/palaces/1/quiz-questions/batch", json=payload)
        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(len(create_response.json()["items"]), 1)
        self.assertEqual(
            create_response.json()["items"][0]["source_meta"]["ocr_source_refs"][0]["page_key"],
            "source_001",
        )

        list_response = self.client.get("/api/v1/palaces/1/quiz-ocr-sources")
        self.assertEqual(list_response.status_code, 200)
        items = list_response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["raw_text"], "原始 OCR 文本")

        isolated_response = self.client.get("/api/v1/palaces/2/quiz-ocr-sources")
        self.assertEqual(isolated_response.status_code, 200)
        self.assertEqual(isolated_response.json()["items"], [])

    def test_chapter_question_save_can_store_palace_ocr_sources_idempotently(self):
        payload = {
            "palace_id": 1,
            "questions": [
                {
                    "question_type": "short_answer",
                    "stem": "章节题也记录宫殿 OCR。",
                    "answer_payload": {"reference_answer": "可以。"},
                    "analysis": "保存为章节题，OCR 归宫殿。",
                    "source_meta": {
                        "source_kind": "text_files",
                        "ocr_source_refs": [
                            {"source_set": "text_files", "page_key": "chapter_001"}
                        ],
                    },
                }
            ],
            "ocr_sources": [
                {
                    "source_kind": "text_files",
                    "source_set": "text_files",
                    "page_key": "chapter_001",
                    "page_number": 1,
                    "image_path": "chapter.txt",
                    "raw_text": "章节来源 OCR",
                    "lines": [],
                    "source_meta": {"filename": "chapter.txt"},
                    "import_batch": "chapter-batch",
                }
            ],
        }

        first = self.client.post(f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch", json=payload)
        self.assertEqual(first.status_code, 200)
        second = self.client.post(f"/api/v1/chapters/{self.chapter_id}/quiz-questions/batch", json=payload)
        self.assertEqual(second.status_code, 200)

        list_response = self.client.get("/api/v1/palaces/1/quiz-ocr-sources")
        self.assertEqual(list_response.status_code, 200)
        matched = [
            item for item in list_response.json()["items"] if item["page_key"] == "chapter_001"
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

    def test_chapter_outline_generation_can_group_by_child_chapter(self):
        calls: list[dict[str, object]] = []

        def fake_call_logged_chat_completion(**kwargs):
            calls.append(kwargs)
            if kwargs["operation"] == "chapter_quiz_generate_outline":
                return (
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "question_type": "multiple_choice",
                                    "stem": "细胞核的功能是什么？",
                                    "options": [
                                        {"id": "A", "text": "控制细胞活动"},
                                        {"id": "B", "text": "储存能量"},
                                    ],
                                    "correct_option_id": "A",
                                    "analysis": "细胞核负责调控。 ",
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    "log-outline",
                )
            return (
                json.dumps(
                    {
                        "mini_palace_groups": [
                            {"mini_palace_id": self.child_chapter_id, "question_indexes": [0]}
                        ],
                        "unassigned_question_indexes": [],
                    },
                    ensure_ascii=False,
                ),
                "log-outline-group",
            )

        with (
            patch.object(palace_quiz_ai_service, "DASHSCOPE_API_KEY", "test-key"),
            patch.object(
                palace_quiz_ai_service,
                "_call_logged_chat_completion",
                side_effect=fake_call_logged_chat_completion,
            ),
        ):
            response = self.client.post(
                f"/api/v1/chapters/{self.chapter_id}/quiz-generation/outline",
                json={
                    "question_types": ["multiple_choice"],
                    "question_count": 1,
                    "extra_prompt": "",
                    "classify_by_child_chapter": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["chapter_id"], self.chapter_id)
        self.assertEqual(payload["questions"][0]["source_chapter_id"], self.chapter_id)
        self.assertEqual(
            payload["grouped_questions"]["child_chapter_groups"][0]["classified_chapter_id"],
            self.child_chapter_id,
        )
        self.assertEqual(calls[0]["operation"], "chapter_quiz_generate_outline")

    def test_recover_quiz_generation_preview_from_successful_ai_log(self):
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id="recover-success-log",
                    feature="宫殿做题",
                    operation="palace_quiz_generate_images",
                    palace_id=1,
                    status="success",
                    provider="openai_compatible",
                    base_url="https://example.test",
                    model="test-model",
                    request_id="test-request",
                    request_json=json.dumps(
                        {
                            "source_meta": {
                                "source_kind": "image_upload",
                                "generation_mode": "single_image",
                                "extra_prompt": "偏重细胞核",
                                "image_names": ["cell.png"],
                                "page_numbers": None,
                                "ai_call_log_id": "recover-success-log",
                            }
                        },
                        ensure_ascii=False,
                    ),
                    response_json=json.dumps(
                        {
                            "response_text": json.dumps(
                                {
                                    "questions": [
                                        {
                                            "question_type": "multiple_choice",
                                            "stem": "细胞核的功能是什么？",
                                            "options": [
                                                {"id": "A", "text": "控制细胞活动"},
                                                {"id": "B", "text": "储存能量"},
                                            ],
                                            "correct_option_id": "A",
                                            "analysis": "细胞核负责调控细胞活动。",
                                        }
                                    ]
                                },
                                ensure_ascii=False,
                            )
                        },
                        ensure_ascii=False,
                    ),
                    error_json="{}",
                )
            )
            session.commit()

        response = self.client.post(
            "/api/v1/palaces/1/quiz-generation/recover-from-log",
            json={"log_id": "recover-success-log"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["recovered_from_log"])
        self.assertEqual(payload["ai_call_log_id"], "recover-success-log")
        self.assertEqual(payload["ocr_sources"], [])
        self.assertEqual(len(payload["questions"]), 1)
        self.assertEqual(payload["questions"][0]["stem"], "细胞核的功能是什么？")
        self.assertEqual(
            payload["questions"][0]["source_meta"]["recovered_from_ai_call_log_id"],
            "recover-success-log",
        )
        self.assertIn("历史 AI 日志恢复", "；".join(payload["warnings"]))

    def test_recover_quiz_generation_preview_rejects_failed_ai_log(self):
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id="recover-error-log",
                    feature="宫殿做题",
                    operation="palace_quiz_generate_images",
                    palace_id=1,
                    status="error",
                    provider="openai_compatible",
                    base_url="https://example.test",
                    model="test-model",
                    request_id="test-request",
                    request_json="{}",
                    response_json="{}",
                    error_json=json.dumps({"message": "boom"}, ensure_ascii=False),
                )
            )
            session.commit()

        response = self.client.post(
            "/api/v1/palaces/1/quiz-generation/recover-from-log",
            json={"log_id": "recover-error-log"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("不是成功记录", response.json()["detail"])

    def test_settings_list_new_prompt_keys_and_quiz_scene_bindings(self):
        prompt_response = self.client.get("/api/v1/settings/ai-prompts")
        self.assertEqual(prompt_response.status_code, 200)
        prompt_keys = {item["key"] for item in prompt_response.json()["items"]}
        self.assertIn("ai_prompt_palace_quiz_generate", prompt_keys)
        self.assertIn("ai_prompt_palace_quiz_classify_existing_to_mini_palace", prompt_keys)
        self.assertIn("ai_prompt_palace_quiz_group_by_mini_palace", prompt_keys)
        self.assertIn("ai_prompt_palace_quiz_short_answer_feedback", prompt_keys)

        model_response = self.client.get("/api/v1/settings/ai-models")
        self.assertEqual(model_response.status_code, 200)
        scenarios = {item["key"]: item for item in model_response.json()["scenes"]}
        self.assertIn("quiz_short_answer_feedback", scenarios)
        self.assertIn("quiz_review_mindmap_generation", scenarios)
        self.assertIn("quiz_mini_palace_grouping", scenarios)
        self.assertEqual(
            scenarios["quiz_short_answer_feedback"]["config_key"],
            "scene_model_quiz_short_answer",
        )
        self.assertEqual(
            scenarios["quiz_review_mindmap_generation"]["config_key"],
            "scene_model_quiz_review_mindmap_generation",
        )
        self.assertEqual(
            scenarios["quiz_mini_palace_grouping"]["config_key"],
            "scene_model_quiz_mini_palace",
        )


for _name, _value in list(PalaceQuizRouteTests.__dict__.items()):
    if _name.startswith("test_") and "pdf" in _name:
        setattr(
            PalaceQuizRouteTests,
            _name,
            unittest.skip("PDF quiz generation was pruned")(_value),
        )


if __name__ == "__main__":
    unittest.main()
