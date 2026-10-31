import json

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.application.question_variants import (
    normalize_variant_stem,
)
from memory_anki.modules.quiz.presentation import router as quiz_router
from memory_anki.modules.settings.presentation import router as settings_router
from support import RouterTestCase


class QuestionVariantRouteTests(RouterTestCase):
    ROUTER_MODULES = (quiz_router, settings_router)

    def seed(self, session):
        palace = Palace(
            title="中教史·第三章",
            description="",
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"text": "第三章", "uid": "root"},
                        "children": [
                            {
                                "data": {
                                    "text": "庆历兴学",
                                    "uid": "qingli",
                                    "note": "易错：范仲淹主持，令州县立学。",
                                },
                                "children": [
                                    {
                                        "data": {"text": "范仲淹", "uid": "fanzhongyan"},
                                        "children": [],
                                    }
                                ],
                            }
                        ],
                    }
                },
                ensure_ascii=False,
            ),
        )
        session.add(palace)
        session.flush()
        question = PalaceQuizQuestion(
            palace_id=palace.id,
            question_type="multiple_choice",
            stem="【333·中教史】北宋首次令州县立学的是（ ）",
            options_json=json.dumps(
                [
                    {"id": "A", "text": "庆历兴学"},
                    {"id": "B", "text": "熙宁兴学"},
                    {"id": "C", "text": "崇宁兴学"},
                    {"id": "D", "text": "绍圣兴学"},
                ],
                ensure_ascii=False,
            ),
            answer_payload_json=json.dumps({"correct_option_id": "A"}),
            analysis="庆历兴学令州县立学。",
            sort_order=1,
        )
        session.add(question)
        session.flush()
        session.add(
            PalaceQuizQuestionNodeBinding(
                palace_id=palace.id,
                question_id=question.id,
                node_uid="qingli",
                source="manual",
            )
        )
        session.commit()
        self.question_id = question.id
        self.palace_id = palace.id

    def _import_item(self, *, base="original", answer="B"):
        return {
            "question_id": self.question_id,
            "base_version_id": base,
            "question_type": "multiple_choice",
            "stem": "北宋三次兴学中，范仲淹主持的庆历兴学的核心措施是（ ）",
            "options": [
                {"id": "A", "text": "创设太学三舍法"},
                {"id": "B", "text": "令州县立学"},
                {"id": "C", "text": "废除科举"},
                {"id": "D", "text": "设立国子监"},
            ],
            "answer_payload": {"correct_option_id": answer},
            "analysis": "庆历兴学由范仲淹主持，核心措施之一是令州县立学。",
        }

    def test_mark_import_activate_restore_delete_and_prompt(self):
        mark = self.client.post(
            f"/api/v1/palace-quiz-questions/{self.question_id}/mutation-mark",
            json={"needs_mutation": True},
        )
        assert mark.status_code == 200
        assert mark.json()["item"]["needs_mutation"] is True

        preview = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()], "dry_run": True},
        )
        assert preview.status_code == 200
        assert preview.json()["imported_count"] == 1
        assert preview.json()["items"] == []

        imported = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()]},
        )
        assert imported.status_code == 200
        body = imported.json()
        assert body["imported_count"] == 1
        item = body["items"][0]
        assert item["active_version_id"] == "v1"
        assert item["variant_count"] == 1
        assert item["needs_mutation"] is False
        assert item["stem"] == "【AI变体】北宋三次兴学中，范仲淹主持的庆历兴学的核心措施是（ ）"
        assert item["answer_payload"] == {"correct_option_id": "B"}
        assert item["original_content"]["stem"].startswith("【333·中教史】")

        versions = self.client.get(
            f"/api/v1/palace-quiz-questions/{self.question_id}/versions"
        )
        assert versions.status_code == 200
        version_body = versions.json()
        assert version_body["active_version_id"] == "v1"
        assert version_body["original"]["version_id"] == "original"
        assert version_body["versions"][0]["version_id"] == "v1"

        # Grading follows the variant answer, not the original row.
        wrong = self.client.post(
            f"/api/v1/palace-quiz-questions/{self.question_id}/choice-attempts",
            json={"selected_option_id": "A", "duration_ms": 3000},
        )
        assert wrong.status_code == 200
        assert wrong.json()["is_correct"] is False
        right = self.client.post(
            f"/api/v1/palace-quiz-questions/{self.question_id}/choice-attempts",
            json={"selected_option_id": "B", "duration_ms": 3000},
        )
        assert right.status_code == 200
        assert right.json()["is_correct"] is True

        restored = self.client.post(
            f"/api/v1/palace-quiz-questions/{self.question_id}/active-variant",
            json={"version_id": "original"},
        )
        assert restored.status_code == 200
        assert restored.json()["item"]["active_version_id"] == "original"
        assert restored.json()["item"]["stem"].startswith("【333·中教史】")

        # Import cleared the mark; mark the original again before copying.
        self.client.post(
            f"/api/v1/palace-quiz-questions/{self.question_id}/mutation-mark",
            json={"needs_mutation": True},
        )
        prompt = self.client.post(
            "/api/v1/palace-quiz-mutation-prompt",
            json={"question_ids": [self.question_id]},
        )
        assert prompt.status_code == 200
        prompt_body = prompt.json()
        assert prompt_body["question_count"] == 1
        assert "bound_nodes" in prompt_body["text"]
        assert "庆历兴学" in prompt_body["text"]
        assert "范仲淹" in prompt_body["text"]

        deleted = self.client.delete(
            f"/api/v1/palace-quiz-questions/{self.question_id}/variants/v1"
        )
        assert deleted.status_code == 200
        assert deleted.json()["item"]["variant_count"] == 0
        assert deleted.json()["item"]["active_version_id"] == "original"

    def test_deleting_the_active_variant_falls_back_to_original(self):
        imported = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()]},
        )
        assert imported.status_code == 200
        assert imported.json()["items"][0]["active_version_id"] == "v1"
        deleted = self.client.delete(
            f"/api/v1/palace-quiz-questions/{self.question_id}/variants/v1"
        )
        assert deleted.status_code == 200
        item = deleted.json()["item"]
        assert item["active_version_id"] == "original"
        assert item["variant_count"] == 0
        assert item["stem"].startswith("【333·中教史】")

    def test_stale_base_version_is_skipped(self):
        first = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()]},
        )
        assert first.status_code == 200
        stale = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item(base="original")]},
        )
        assert stale.status_code == 200
        assert stale.json()["imported_count"] == 0
        assert stale.json()["results"][0]["code"] == "stale_base"

    def test_auto_mark_thresholds_come_from_settings(self):
        settings = self.client.put(
            "/api/v1/settings/review",
            json={"quiz_mutation_max_duration_ms": "1000"},
        )
        assert settings.status_code == 200
        imported = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()]},
        )
        assert imported.status_code == 200
        for _index in range(3):
            response = self.client.post(
                f"/api/v1/palace-quiz-questions/{self.question_id}/choice-attempts",
                json={"selected_option_id": "B", "duration_ms": 3000},
            )
            assert response.status_code == 200
            assert response.json()["auto_marked"] is False
        assert response.json()["question"]["needs_mutation"] is False

    def test_auto_mark_after_three_fast_correct_answers(self):
        imported = self.client.post(
            "/api/v1/palace-quiz-question-variants/import",
            json={"items": [self._import_item()]},
        )
        assert imported.status_code == 200
        for index in range(3):
            response = self.client.post(
                f"/api/v1/palace-quiz-questions/{self.question_id}/choice-attempts",
                json={"selected_option_id": "B", "duration_ms": 3000},
            )
            assert response.status_code == 200
            assert response.json()["is_correct"] is True
            if index < 2:
                assert response.json()["auto_marked"] is False
        assert response.json()["auto_marked"] is True
        assert response.json()["question"]["needs_mutation"] is True
        assert response.json()["question"]["consecutive_correct_count"] == 3
        assert response.json()["question"]["last_answer_duration_ms"] == 3000


class QuestionVariantPureTests(RouterTestCase):
    def test_stem_tag_is_idempotent(self):
        assert (
            normalize_variant_stem("【333·中教史】原题")
            == "【333·中教史】【AI变体】原题"
        )
        assert (
            normalize_variant_stem("【AI变体】【333·中教史】原题")
            == "【AI变体】【333·中教史】原题"
        )
        assert normalize_variant_stem("原题") == "【AI变体】原题"
