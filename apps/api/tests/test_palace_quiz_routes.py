import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import (
    Base,
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
    Subject,
    SubjectDocument,
)
from memory_anki.modules.palace_quiz.application import ai_service as palace_quiz_ai_service
from memory_anki.modules.palace_quiz.presentation import router as palace_quiz_router
from memory_anki.modules.settings.presentation import router as settings_router


class PalaceQuizRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_quiz_get_session = palace_quiz_router.get_session
        self.original_settings_get_session = settings_router.get_session

        def get_test_session():
            return self.SessionLocal()

        palace_quiz_router.get_session = get_test_session
        settings_router.get_session = get_test_session

        with self.SessionLocal() as session:
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
            session.add(
                PalaceMiniPalace(
                    palace_id=palace.id,
                    name="细胞核小宫殿",
                    node_uids_json=json.dumps(["cell-core"], ensure_ascii=False),
                    sort_order=0,
                )
            )
            session.add(
                SubjectDocument(
                    subject_id=subject.id,
                    filename="subjects/1/demo.pdf",
                    original_name="demo.pdf",
                    mime_type="application/pdf",
                    file_size=123,
                    page_count=12,
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

        app = FastAPI()
        app.include_router(palace_quiz_router.router, prefix="/api/v1")
        app.include_router(settings_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        palace_quiz_router.get_session = self.original_quiz_get_session
        settings_router.get_session = self.original_settings_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

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
        self.assertEqual(
            captured["request_payload"]["model_input"],
            {
                "stem": "简述有丝分裂的意义。",
                "user_answer": "可以保证细胞正常分裂。",
                "reference_answer": "保证遗传信息稳定传递。",
                "analysis": "核心在于遗传物质平均分配。",
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
        self.assertIn("资料来源清单", calls[0]["request_payload"]["source_context"])
        self.assertEqual(len(calls[0]["image_items"]), 2)
        self.assertEqual(calls[1]["operation"], "palace_quiz_pair_pdf_with_turbo")
        self.assertEqual(payload["generation_stats"]["returned_count"], 1)

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
            yield '[{"question_type":"short_answer","stem":"概括英国教育特点。","reference_answer":"英国教育具有渐进改革特点。","analysis":"结合题目册和解析册整理。"}]}'
            return '{"questions":[{"question_type":"short_answer","stem":"概括英国教育特点。","reference_answer":"英国教育具有渐进改革特点。","analysis":"结合题目册和解析册整理。"}]}'

        def fake_pairing_chat_completion(**kwargs):
            return (
                '{"questions":[{"question_type":"short_answer","stem":"概括英国教育特点。","reference_answer":"英国教育具有渐进改革特点。","analysis":"Turbo 已配对题目册和解析册。"}]}',
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
                    "extra_prompt": "只要英国的",
                },
            )

        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn("event: status", body)
        self.assertIn("event: delta", body)
        self.assertIn("event: result", body)
        self.assertIn("正在用 Turbo 配对题目与答案", body)
        self.assertIn("概括英国教育特点", body)
        self.assertIn("log-pair", body)

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
        self.assertIn("quiz_mini_palace_grouping", scenarios)
        self.assertEqual(
            scenarios["quiz_short_answer_feedback"]["config_key"],
            "scene_model_quiz_short_answer",
        )
        self.assertEqual(
            scenarios["quiz_mini_palace_grouping"]["config_key"],
            "scene_model_quiz_mini_palace",
        )


if __name__ == "__main__":
    unittest.main()
