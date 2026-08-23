from __future__ import annotations

import json
import unittest

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.quiz.application.question_contracts import (
    sort_questions_for_bank_display,
)
from memory_anki.modules.quiz.presentation import router as palace_quiz_router
from support import RouterTestCase


class QuizBankDisplayOrderTests(RouterTestCase):
    ROUTER_MODULES = (palace_quiz_router,)

    def seed(self, session):
        palace = Palace(title="Display Order Palace", description="", editor_doc="{}")
        session.add(palace)
        session.commit()
        self.palace_id = int(palace.id)

    def test_sort_helper_puts_multiple_choice_before_short_answer(self):
        ordered = sort_questions_for_bank_display(
            [
                {"id": 1, "question_type": "short_answer", "sort_order": 0},
                {"id": 2, "question_type": "multiple_choice", "sort_order": 10},
                {"id": 3, "question_type": "short_answer", "sort_order": 1},
                {"id": 4, "question_type": "multiple_choice", "sort_order": 2},
            ]
        )
        self.assertEqual([item["id"] for item in ordered], [4, 2, 1, 3])

    def test_palace_question_list_groups_choice_before_short_answer(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    PalaceQuizQuestion(
                        palace_id=self.palace_id,
                        question_type="short_answer",
                        stem="先写下的简答题。",
                        options_json="[]",
                        answer_payload_json=json.dumps(
                            {"reference_answer": "参考答案。"},
                            ensure_ascii=False,
                        ),
                        analysis="简答解析。",
                        source_meta_json="{}",
                        sort_order=0,
                    ),
                    PalaceQuizQuestion(
                        palace_id=self.palace_id,
                        question_type="multiple_choice",
                        stem="后写入的选择题？",
                        options_json=json.dumps(
                            [
                                {"id": "A", "text": "甲"},
                                {"id": "B", "text": "乙"},
                            ],
                            ensure_ascii=False,
                        ),
                        answer_payload_json=json.dumps(
                            {"correct_option_id": "A"},
                            ensure_ascii=False,
                        ),
                        analysis="选择解析。",
                        source_meta_json="{}",
                        sort_order=10,
                    ),
                ]
            )
            session.commit()

        response = self.client.get(f"/api/v1/palaces/{self.palace_id}/quiz-questions")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["question_type"] for item in response.json()["items"]],
            ["multiple_choice", "short_answer"],
        )
        self.assertEqual(
            [item["stem"] for item in response.json()["items"]],
            ["后写入的选择题？", "先写下的简答题。"],
        )

    def test_aggregated_question_list_also_groups_by_type(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    PalaceQuizQuestion(
                        palace_id=self.palace_id,
                        question_type="short_answer",
                        stem="宫殿简答题。",
                        options_json="[]",
                        answer_payload_json=json.dumps(
                            {"reference_answer": "参考答案。"},
                            ensure_ascii=False,
                        ),
                        analysis="简答解析。",
                        source_meta_json="{}",
                        sort_order=0,
                    ),
                    PalaceQuizQuestion(
                        palace_id=self.palace_id,
                        question_type="multiple_choice",
                        stem="宫殿选择题？",
                        options_json=json.dumps(
                            [
                                {"id": "A", "text": "甲"},
                                {"id": "B", "text": "乙"},
                            ],
                            ensure_ascii=False,
                        ),
                        answer_payload_json=json.dumps(
                            {"correct_option_id": "A"},
                            ensure_ascii=False,
                        ),
                        analysis="选择解析。",
                        source_meta_json="{}",
                        sort_order=10,
                    ),
                ]
            )
            session.commit()

        response = self.client.get(f"/api/v1/palaces/{self.palace_id}/aggregated-quiz-questions")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["question_type"] for item in response.json()["items"]],
            ["multiple_choice", "short_answer"],
        )


if __name__ == "__main__":
    unittest.main()
