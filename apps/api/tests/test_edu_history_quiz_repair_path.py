"""Regression tests for education-history quiz audit repair write path.

Drives the real quiz application commands used when fixing:
- short_answer payloads that only store a letter (e.g. "C")
- junk analysis left from wrong MC paste (must be cleared/replaced)
- updates that must clear a stale origin_question_id
- soft-delete of misplaced/cross-palace duplicates
- batch create of missing PDF-backed items
"""

from __future__ import annotations

import json
import re
import unittest

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.quiz.application.questions.commands import (
    batch_create_questions,
    batch_delete_questions,
    update_question,
)
from memory_anki.modules.quiz.application.questions.validation import json_load
from support import RouterTestCase


def _norm_stem(stem: str) -> str:
    s = re.sub(r"\s+", "", stem or "")
    s = re.sub(r"【[^】]*】", "", s)
    return s.lower()


class EduHistoryQuizRepairPathTests(RouterTestCase):
    ROUTER_MODULES = ()

    # MC junk analysis paste patterns seen in the live audit (must not survive repair).
    JUNK_SA_ANALYSIS = (
        "四个选项都是蔡元培提出的教育思想内容。A选项是教育独立的主张;"
        "题干“大学者,‘囊括大典,网罗众家’之学府也”体现的是思想自由、兼容并包的思想。"
    )
    JUNK_MC_ANALYSIS = (
        "西方“七艺”为文法、修辞学、辩证法、算术、几何、天文、音乐。"
        "确立“前三艺”的是智者派;确立“后四艺”的是柏拉图。"
    )
    PDF_MC_ANALYSIS = (
        "正确答案为B。A选项斯巴达相对于雅典更注重军事体育的训练；"
        "C选项斯巴达相对雅典更注重女子教育。"
    )

    def seed(self, session: Session) -> None:
        palace_a = Palace(title="第二节 蔡元培的教育思想与实践", description="")
        palace_b = Palace(title="第一节东方文明古国的教育", description="")
        palace_c = Palace(title="第二节法国近代教育", description="")
        palace_d = Palace(title="第二节古希腊的教育阶段", description="")
        session.add_all([palace_a, palace_b, palace_c, palace_d])
        session.flush()
        self.palace_a_id = palace_a.id
        self.palace_b_id = palace_b.id
        self.palace_c_id = palace_c.id
        self.palace_d_id = palace_d.id

        # Broken short_answer with letter-only reference + MC junk analysis.
        broken_sa = PalaceQuizQuestion(
            palace_id=palace_a.id,
            question_type="short_answer",
            stem="对比洪堡柏林大学的改革和蔡元培北京大学的改革。",
            options_json="[]",
            answer_payload_json=json.dumps({"reference_answer": "C"}, ensure_ascii=False),
            analysis=self.JUNK_SA_ANALYSIS,
            source_meta_json="{}",
            sort_order=1,
            lifecycle_status="published",
            origin_question_id=999999,
        )
        # Wrong key + option D matches live PDF (京师大学堂), empty analysis ok.
        wrong_mc = PalaceQuizQuestion(
            palace_id=palace_a.id,
            question_type="multiple_choice",
            stem="以下关于蔡元培的实践活动,说法不正确的是(",
            options_json=json.dumps(
                [
                    {"id": "A", "text": "曾参与发起成立中国教育会"},
                    {"id": "B", "text": "曾组建爱国女学、爱国学社"},
                    {"id": "C", "text": "曾组织勤工俭学会"},
                    {"id": "D", "text": "曾参与创办京师大学堂"},
                ],
                ensure_ascii=False,
            ),
            answer_payload_json=json.dumps({"correct_option_id": "C"}, ensure_ascii=False),
            analysis="",
            source_meta_json="{}",
            sort_order=2,
            lifecycle_status="published",
            origin_question_id=999998,
        )
        # Key already wrong + analysis is unrelated junk paste (Greek 七艺 on Athens/Sparta item).
        junk_analysis_mc = PalaceQuizQuestion(
            palace_id=palace_d.id,
            question_type="multiple_choice",
            stem="雅典教育相对于斯巴达教育而言（ ）",
            options_json=json.dumps(
                [
                    {"id": "A", "text": "更注重军事体育的训练"},
                    {"id": "B", "text": "具有更高的制度化水平"},
                    {"id": "C", "text": "更注重对女子进行教育"},
                    {"id": "D", "text": "更强调对自由民的教育"},
                ],
                ensure_ascii=False,
            ),
            answer_payload_json=json.dumps({"correct_option_id": "C"}, ensure_ascii=False),
            analysis=self.JUNK_MC_ANALYSIS,
            source_meta_json="{}",
            sort_order=1,
            lifecycle_status="published",
            origin_question_id=999997,
        )
        # Misplaced French item under 东方文明 + canonical copy under 法国.
        misplaced = PalaceQuizQuestion(
            palace_id=palace_b.id,
            question_type="multiple_choice",
            stem="设想了按照年龄划分的三级教育制度：5~10岁、10~16岁、16岁以上，提出各阶段的学习都要注重本国语和科学学科的思想家是（）",
            options_json=json.dumps(
                [
                    {"id": "A", "text": "爱尔维修"},
                    {"id": "B", "text": "狄德罗"},
                    {"id": "C", "text": "拉夏洛泰"},
                    {"id": "D", "text": "洛克"},
                ],
                ensure_ascii=False,
            ),
            answer_payload_json=json.dumps({"correct_option_id": "C"}, ensure_ascii=False),
            analysis="",
            source_meta_json="{}",
            sort_order=1,
            lifecycle_status="published",
        )
        canonical = PalaceQuizQuestion(
            palace_id=palace_c.id,
            question_type="multiple_choice",
            stem="设想了按照年龄划分的三级教育制度：5~10岁、10~16岁、16岁以上，提出各阶段的学习都要注重本国语和科学学科的思想家是（）",
            options_json=json.dumps(
                [
                    {"id": "A", "text": "爱尔维修"},
                    {"id": "B", "text": "狄德罗"},
                    {"id": "C", "text": "拉夏洛泰"},
                    {"id": "D", "text": "洛克"},
                ],
                ensure_ascii=False,
            ),
            answer_payload_json=json.dumps({"correct_option_id": "C"}, ensure_ascii=False),
            analysis="",
            source_meta_json="{}",
            sort_order=1,
            lifecycle_status="published",
        )
        session.add_all([broken_sa, wrong_mc, junk_analysis_mc, misplaced, canonical])
        session.commit()
        self.broken_sa_id = broken_sa.id
        self.wrong_mc_id = wrong_mc.id
        self.junk_analysis_mc_id = junk_analysis_mc.id
        self.misplaced_id = misplaced.id
        self.canonical_id = canonical.id

    def test_repair_short_answer_letter_clears_junk_analysis(self) -> None:
        with self.SessionLocal() as session:
            real_ref = (
                "洪堡对柏林大学的改革，带来了大学教育实质性的变化。"
                "蔡元培改造北京大学时继承并发扬了柏林大学的办学精神。"
            )
            updated = update_question(
                session,
                self.broken_sa_id,
                {
                    "question_type": "short_answer",
                    "stem": "对比洪堡柏林大学的改革和蔡元培北京大学的改革。",
                    "options": [],
                    "reference_answer": real_ref,
                    "answer_payload": {"reference_answer": real_ref},
                    # Explicitly clear MC-paste analysis that does not belong on an essay.
                    "analysis": "",
                    "origin_question_id": None,
                    "source_meta": {
                        "import_batch": "edu-history-quiz-audit-repair-test",
                        "source_kind": "unit_test",
                    },
                },
            )
            self.assertEqual(updated["id"], self.broken_sa_id)
            row = session.get(PalaceQuizQuestion, self.broken_sa_id)
            assert row is not None
            payload = json_load(row.answer_payload_json, {})
            ref = str(payload.get("reference_answer") or "").strip()
            self.assertFalse(re.fullmatch(r"[A-Da-d]", ref))
            self.assertIn("洪堡", ref)
            self.assertIsNone(row.origin_question_id)
            # Analysis must not retain the unrelated MC paste.
            analysis = row.analysis or ""
            self.assertNotIn("囊括大典", analysis)
            self.assertNotIn("思想自由", analysis)
            self.assertEqual(analysis.strip(), "")

    def test_repair_wrong_mc_key_with_stale_origin(self) -> None:
        with self.SessionLocal() as session:
            options = [
                {"id": "A", "text": "曾参与发起成立中国教育会"},
                {"id": "B", "text": "曾组建爱国女学、爱国学社"},
                {"id": "C", "text": "曾组织勤工俭学会"},
                {"id": "D", "text": "曾参与创办京师大学堂"},
            ]
            pdf_analysis = "京师大学堂是百日维新期间创办的，蔡元培并未参与。其余选项均为蔡元培的教育实践活动。"
            update_question(
                session,
                self.wrong_mc_id,
                {
                    "question_type": "multiple_choice",
                    "stem": "以下关于蔡元培的实践活动,说法不正确的是(",
                    "options": options,
                    "correct_option_id": "D",
                    "answer_payload": {"correct_option_id": "D"},
                    "analysis": pdf_analysis,
                    "origin_question_id": None,
                    "source_meta": {"import_batch": "edu-history-quiz-audit-repair-test"},
                },
            )
            row = session.get(PalaceQuizQuestion, self.wrong_mc_id)
            assert row is not None
            payload = json_load(row.answer_payload_json, {})
            self.assertEqual(payload.get("correct_option_id"), "D")
            self.assertIsNone(row.origin_question_id)
            self.assertIn("京师大学堂", row.analysis or "")
            opts = json_load(row.options_json, [])
            d_text = next(o["text"] for o in opts if o["id"] == "D")
            self.assertEqual(d_text, "曾参与创办京师大学堂")

    def test_repair_mc_replaces_junk_analysis_with_pdf_explanation(self) -> None:
        """Key-only fix is insufficient: analysis must also leave junk paste territory."""
        with self.SessionLocal() as session:
            options = [
                {"id": "A", "text": "更注重军事体育的训练"},
                {"id": "B", "text": "具有更高的制度化水平"},
                {"id": "C", "text": "更注重对女子进行教育"},
                {"id": "D", "text": "更强调对自由民的教育"},
            ]
            update_question(
                session,
                self.junk_analysis_mc_id,
                {
                    "question_type": "multiple_choice",
                    "stem": "雅典教育相对于斯巴达教育而言（ ）",
                    "options": options,
                    "correct_option_id": "B",
                    "answer_payload": {"correct_option_id": "B"},
                    "analysis": self.PDF_MC_ANALYSIS,
                    "origin_question_id": None,
                    "source_meta": {"import_batch": "edu-history-quiz-audit-repair-test"},
                },
            )
            row = session.get(PalaceQuizQuestion, self.junk_analysis_mc_id)
            assert row is not None
            payload = json_load(row.answer_payload_json, {})
            self.assertEqual(payload.get("correct_option_id"), "B")
            analysis = row.analysis or ""
            self.assertIn("正确答案为B", analysis)
            self.assertNotIn("七艺", analysis)
            self.assertNotIn("智者派", analysis)
            self.assertNotIn("柏拉图", analysis)

    def test_soft_delete_misplaced_duplicate_keeps_canonical(self) -> None:
        with self.SessionLocal() as session:
            deleted = batch_delete_questions(session, [self.misplaced_id])
            self.assertEqual(deleted, 1)
            misplaced = session.get(PalaceQuizQuestion, self.misplaced_id)
            canonical = session.get(PalaceQuizQuestion, self.canonical_id)
            assert misplaced is not None and canonical is not None
            self.assertIsNotNone(misplaced.deleted_at)
            self.assertIsNone(canonical.deleted_at)
            self.assertEqual(
                json_load(canonical.answer_payload_json, {}).get("correct_option_id"),
                "C",
            )

    def test_batch_create_missing_pdf_item_and_no_intra_palace_dup(self) -> None:
        with self.SessionLocal() as session:
            created = batch_create_questions(
                session,
                self.palace_a_id,
                [
                    {
                        "question_type": "multiple_choice",
                        "stem": "【2009年311真题20】蔡元培对大学精神的解释是（ ）",
                        "options": [
                            {"id": "A", "text": "大学者，非谓有大楼之谓也，有大师之谓也"},
                            {"id": "B", "text": "大学之道，在明明德，在亲民，在止于至善"},
                            {"id": "C", "text": "大学者，‘囊括大典，网罗众家’之学府也"},
                            {"id": "D", "text": "学术独立，思想自由，政罗教纲无羁绊之学府也"},
                        ],
                        "correct_option_id": "C",
                        "analysis": "题干“囊括大典，网罗众家”体现思想自由、兼容并包。",
                        "source_meta": {
                            "import_batch": "edu-history-quiz-audit-repair-test",
                            "source_kind": "unit_test",
                        },
                    }
                ],
            )
            self.assertEqual(len(created), 1)
            new_id = created[0]["id"]
            row = session.get(PalaceQuizQuestion, new_id)
            assert row is not None
            self.assertEqual(row.palace_id, self.palace_a_id)
            self.assertEqual(
                json_load(row.answer_payload_json, {}).get("correct_option_id"),
                "C",
            )
            self.assertIn("兼容并包", row.analysis or "")

            active = (
                session.query(PalaceQuizQuestion)
                .filter(
                    PalaceQuizQuestion.palace_id == self.palace_a_id,
                    PalaceQuizQuestion.deleted_at.is_(None),
                )
                .all()
            )
            stems = [_norm_stem(q.stem or "") for q in active]
            self.assertEqual(len(stems), len(set(stems)))


if __name__ == "__main__":
    unittest.main()
