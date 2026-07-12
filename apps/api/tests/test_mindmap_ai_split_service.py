from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.palaces.application import mindmap_ai_split_service as service
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog


def _build_editor_doc() -> dict:
    return {
        "root": {
            "data": {
                "text": "测试宫殿",
                "memoryAnkiRootKind": "palace",
            },
            "children": [
                {
                    "data": {
                        "text": "待分卡节点",
                        "uid": "target-1",
                        "memoryAnkiNodeType": "peg",
                    },
                    "children": [
                        {
                            "data": {
                                "text": "已有子节点一",
                                "uid": "child-1",
                                "memoryAnkiNodeType": "peg",
                            },
                            "children": [
                                {
                                    "data": {
                                        "text": "后代一",
                                        "uid": "leaf-1",
                                        "memoryAnkiNodeType": "peg",
                                    },
                                    "children": [],
                                }
                            ],
                        },
                        {
                            "data": {
                                "text": "已有子节点二",
                                "uid": "child-2",
                                "memoryAnkiNodeType": "peg",
                            },
                            "children": [],
                        },
                        {
                            "data": {
                                "text": "已有子节点三",
                                "uid": "child-3",
                                "memoryAnkiNodeType": "peg",
                            },
                            "children": [],
                        },
                    ],
                }
            ],
        }
    }


@pytest.fixture(autouse=True)
def _mindmap_ai_split_test_defaults(
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(service, "DASHSCOPE_BASE_URL", "https://dashscope.test/v1")
    monkeypatch.setattr(service, "DASHSCOPE_TEXT_MODEL", "qwen3.6-flash")
    palace = Palace(title="测试宫殿", description="")
    db_session.add(palace)
    db_session.commit()


def _ai_runtime(session: Session) -> SettingsAiRuntimeProvider:
    return SettingsAiRuntimeProvider(session)


def _prompt_catalog(session: Session) -> SettingsPromptCatalog:
    return SettingsPromptCatalog(session)


def _get_palace(session: Session) -> Palace:
    palace = session.query(Palace).first()
    assert palace is not None
    return palace


def test_leaf_target_generates_parallel_children_when_no_existing_children(db_session: Session):
    editor_doc = _build_editor_doc()
    target_node = editor_doc["root"]["children"][0]
    target_node["children"] = []

    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [
                {"id": "category_1", "text": "定义"},
                {"id": "category_2", "text": "例子"},
            ],
            "child_assignments": [],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
        )

    children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in children] == ["定义", "例子"]
    assert all(child["children"] == [] for child in children)
    assert result.generated_children_count == 2
    assert result.reassigned_existing_children_count == 0
    assert result.review_preview is not None
    assert result.review_preview["node_count"] == 3
    assert result.review_preview["suggested_segments"]["count"] == 0


def test_existing_children_only_move_without_rewriting_descendants(db_session: Session):
    editor_doc = _build_editor_doc()

    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [
                {"id": "category_1", "text": "概念类"},
                {"id": "category_2", "text": "应用类"},
            ],
            "child_assignments": [
                {"source_ref": "uid:child-1", "target_new_child_id": "category_1"},
                {"source_ref": "uid:child-2", "target_new_child_id": "category_2"},
                {"source_ref": "uid:child-3", "target_new_child_id": "category_2"},
            ],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
        )

    target_children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in target_children] == ["概念类", "应用类"]
    moved_first = target_children[0]["children"][0]
    moved_second_group = target_children[1]["children"]
    assert moved_first["data"]["text"] == "已有子节点一"
    assert moved_first["children"][0]["data"]["text"] == "后代一"
    assert [child["data"]["text"] for child in moved_second_group] == ["已有子节点二", "已有子节点三"]
    assert result.reassigned_existing_children_count == 3


def test_duplicate_and_unknown_assignments_fall_back_to_uncategorized_bucket(db_session: Session):
    editor_doc = _build_editor_doc()

    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [
                {"id": "category_1", "text": "主类"},
                {"id": "category_2", "text": "副类"},
            ],
            "child_assignments": [
                {"source_ref": "uid:child-1", "target_new_child_id": "category_1"},
                {"source_ref": "uid:child-1", "target_new_child_id": "category_2"},
                {"source_ref": "uid:missing", "target_new_child_id": "category_1"},
            ],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
        )

    target_children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in target_children] == ["主类", "副类", service.AI_SPLIT_FALLBACK_BUCKET]
    assert [child["data"]["text"] for child in target_children[0]["children"]] == ["已有子节点一"]
    assert target_children[1]["children"] == []
    assert [child["data"]["text"] for child in target_children[2]["children"]] == ["已有子节点二", "已有子节点三"]
    assert result.generated_children_count == 3
    assert result.reassigned_existing_children_count == 3


def test_root_target_uid_none_replaces_root_children(db_session: Session):
    editor_doc = {
        "root": {
            "data": {"text": "测试宫殿", "memoryAnkiRootKind": "palace"},
            "children": [
                {"data": {"text": "根子节点一", "uid": "root-child-1"}, "children": []},
                {"data": {"text": "根子节点二", "uid": "root-child-2"}, "children": []},
            ],
        }
    }

    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [{"id": "category_1", "text": "总分类"}],
            "child_assignments": [
                {"source_ref": "uid:root-child-1", "target_new_child_id": "category_1"},
                {"source_ref": "uid:root-child-2", "target_new_child_id": "category_1"},
            ],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            None,
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
        )

    root_children = result.editor_doc["root"]["children"]
    assert len(root_children) == 1
    assert root_children[0]["data"]["text"] == "总分类"
    assert [child["data"]["text"] for child in root_children[0]["children"]] == ["根子节点一", "根子节点二"]


def test_split_granularity_is_inferred_from_existing_children(db_session: Session):
    editor_doc = _build_editor_doc()
    target_children = editor_doc["root"]["children"][0]["children"]
    for index in range(4, 11):
        target_children.append(
            {
                "data": {"text": f"已有子节点{index}", "uid": f"child-{index}"},
                "children": [],
            }
        )
    db_session.add(Config(key="mindmap_ai_split_max_children", value="12"))
    db_session.commit()

    def fake_call(*, config, target_node, existing_children, prompt_catalog):
        assert config.max_children == 4
        return {
            "new_children": [
                {"id": f"category_{index}", "text": f"学习组{index}"}
                for index in range(1, 6)
            ],
            "child_assignments": [
                {
                    "source_ref": f"uid:child-{index}",
                    "target_new_child_id": f"category_{((index - 1) % 4) + 1}",
                }
                for index in range(1, 11)
            ],
        }

    with patch.object(service, "_call_mindmap_ai_split_model", side_effect=fake_call):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
        )

    children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in children] == ["学习组1", "学习组2", "学习组3", "学习组4"]
    assert result.generated_children_count == 4
    assert result.reassigned_existing_children_count == 10


def test_config_falls_back_to_environment_values(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", "env-key")
    monkeypatch.setattr(service, "DASHSCOPE_BASE_URL", "https://example.test/v1")
    monkeypatch.setattr(service, "DASHSCOPE_TEXT_MODEL", "qwen-env")

    config = service.resolve_mindmap_ai_split_config(
        db_session,
        ai_runtime=_ai_runtime(db_session),
    )

    assert config.api_key == "env-key"
    assert config.base_url == "https://example.test/v1"
    assert config.model == "qwen-env"
    assert config.temperature == pytest.approx(0.2)
    assert config.max_children == 5
    assert config.include_note is True


def test_config_raises_clear_error_when_api_key_is_missing(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", None)
    db_session.add(Config(key="mindmap_ai_split_api_key", value=""))
    db_session.commit()

    with pytest.raises(service.MindMapAiSplitError, match="API Key"):
        service.resolve_mindmap_ai_split_config(
            db_session,
            ai_runtime=_ai_runtime(db_session),
        )
