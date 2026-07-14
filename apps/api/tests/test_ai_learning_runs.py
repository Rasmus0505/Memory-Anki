from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables._base import Base
from memory_anki.modules.ai_learning.application import service
from memory_anki.modules.ai_learning.domain.schemas import AiRunDraft
from memory_anki.platform.application import AiRuntimeOptions, ResolvedAiRuntime


class Provider:
    def normalize_options(self, value):
        return AiRuntimeOptions(model=(value or {}).get("model"))

    def resolve(self, scenario_key, *, options=None):
        return ResolvedAiRuntime(
            scene_key=scenario_key,
            scene_label="AI学习",
            model_key="m",
            model_label="Model",
            model="provider-model",
            provider="test",
            model_type="llm",
            has_vision=False,
            thinking_enabled=False,
            supports_temperature=True,
            structured_output_mode="",
            input_price_per_million=None,
            output_price_per_million=None,
            cached_input_price_per_million=None,
            api_key="SECRET",
            base_url="http://example.test/v1",
            extra_payload=None,
            prompt_override=None,
            public_metadata={
                "scene_key": scenario_key,
                "model_key": "m",
                "model_label": "Model",
                "provider": "test",
                "model_type": "llm",
                "has_vision": False,
                "thinking_enabled": False,
            },
        )


class Catalog:
    def render(self, key, variables=None):
        assert key == "ai_prompt_ai_learning_workbench"
        return f"学习工作台规则\n\n{(variables or {}).get('task_instruction', '')}"


def draft(operation_id="op-1"):
    return AiRunDraft.model_validate(
        {
            "task_key": "ask",
            "context": {
                "source_type": "review_mindmap",
                "source_entity_id": "1",
                "source_revision": "rev-1",
                "scope": "subtree",
                "title": "T",
                "node_uids": ["n1"],
                "nodes": [{"uid": "n1", "title": "Node", "note": "Note"}],
            },
            "user_prompt": "为什么？",
            "owner_id": "review:1",
            "operation_id": operation_id,
            "review_session_id": 1,
            "palace_id": 2,
        }
    )


def test_preview_and_execution_are_consistent_and_secret_free(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(service, "call_chat_completion_text", lambda **kwargs: "回答")
    with Session(engine) as session:
        expected = service.preview_run(draft(), Catalog())
        result = service.execute_run(session, draft(), Provider(), Catalog())
        assert result["status"] == "completed" and result["response_text"] == "回答"
        assert result["request"]["messages"] == expected["messages"]
        assert "SECRET" not in str(result)
        assert service.execute_run(session, draft(), Provider(), Catalog())["id"] == result["id"]


def test_long_context_warns_without_silent_truncation():
    value = draft("op-2")
    value.context.estimated_tokens = 25000
    preview = service.preview_run(value, Catalog())
    assert preview["warnings"] and len(preview["context_text"]) > 0


def test_context_selection_lifecycle_and_soft_delete(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(service, "call_chat_completion_text", lambda **kwargs: "回答")
    value = draft("op-3")
    value.context_selections = [
        {
            "kind": "quiz_bank",
            "enabled": True,
            "source_entity_id": "2",
            "source_revision": "quiz-r1",
            "label": "当前题库",
            "content": "题目：示例题",
        }
    ]
    with Session(engine) as session:
        preview = service.preview_run(value, Catalog())
        assert "当前题库" in preview["context_text"]
        result = service.execute_run(session, value, Provider(), Catalog())
        accepted = service.set_application_status(session, result["id"], "accepted", {})
        assert accepted["application_status"] == "accepted"
        deleted = service.set_deleted(session, result["id"], True)
        assert deleted["deleted"] is True
        assert service.list_runs(session, review_session_id=1) == []
        restored = service.set_deleted(session, result["id"], False)
        assert restored["deleted"] is False
        service.set_deleted(session, result["id"], True)
        service.purge_run(session, result["id"])
        assert service.list_runs(session, review_session_id=1, include_deleted=True) == []


def test_quiz_result_is_structured_and_items_can_be_reviewed(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(
        service,
        "call_chat_completion_text",
        lambda **kwargs: '{"questions":[{"id":"q1","stem":"示例题","answer":"答案","analysis":"解析","source_node_uids":["n1"]}]}',
    )
    value = draft("op-structured")
    value.task_key = "quiz"
    value.output_type = "quiz_draft"
    with Session(engine) as session:
        result = service.execute_run(session, value, Provider(), Catalog())
        assert result["result"]["kind"] == "quiz_draft"
        assert result["result"]["questions"][0]["decision"] == "pending"
        reviewed = service.set_item_decision(session, result["id"], "q1", "accepted")
        assert reviewed["result"]["questions"][0]["decision"] == "accepted"
