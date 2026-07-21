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


def _add_kwargs(session: Session, **extra):
    palace = _get_palace(session)
    return {
        "ai_runtime": _ai_runtime(session),
        "prompt_catalog": _prompt_catalog(session),
        "owner_id": f"palace:{palace.id}",
        "operation_id": "operation-add",
        **extra,
    }


def test_add_children_rejects_fewer_than_two_first_level_children(db_session: Session):
    editor_doc = _build_editor_doc()
    editor_doc["root"]["children"][0]["children"] = []
    with pytest.raises(service.MindMapAiSplitError, match="至少 2 个一级子节点"):
        service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            split_mode="add_children",
            **_add_kwargs(db_session),
        )


def test_existing_children_only_move_without_rewriting_descendants(db_session: Session):
    editor_doc = _build_editor_doc()
    palace = _get_palace(db_session)

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
            palace,
            editor_doc,
            "target-1",
            split_mode="add_children",
            **_add_kwargs(db_session, operation_id="operation-add-move"),
        )

    target_children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in target_children] == ["概念类", "应用类"]
    moved_first = target_children[0]["children"][0]
    moved_second_group = target_children[1]["children"]
    assert moved_first["data"]["text"] == "已有子节点一"
    assert moved_first["data"]["uid"] == "child-1"
    assert moved_first["children"][0]["data"]["text"] == "后代一"
    assert moved_first["children"][0]["data"]["uid"] == "leaf-1"
    assert [child["data"]["text"] for child in moved_second_group] == ["已有子节点二", "已有子节点三"]
    assert result.reassigned_existing_children_count == 3
    assert result.split_mode == "add_children"
    assert result.replacement_nodes is not None
    assert len(result.replacement_nodes) == 2
    assert result.replacement_nodes[0]["children"][0]["data"]["uid"] == "child-1"
    assert result.operation_id == "operation-add-move"
    assert result.owner_id == f"palace:{palace.id}"


def test_legacy_children_alias_maps_to_add_children(db_session: Session):
    editor_doc = _build_editor_doc()
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [
                {"id": "category_1", "text": "目的"},
                {"id": "category_2", "text": "内容"},
            ],
            "child_assignments": [
                {"source_ref": "uid:child-1", "target_new_child_id": "category_1"},
                {"source_ref": "uid:child-2", "target_new_child_id": "category_1"},
                {"source_ref": "uid:child-3", "target_new_child_id": "category_2"},
            ],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            split_mode="legacy_children",
            **_add_kwargs(db_session),
        )
    assert result.split_mode == "add_children"
    assert [child["data"]["text"] for child in result.editor_doc["root"]["children"][0]["children"]] == [
        "目的",
        "内容",
    ]


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
            split_mode="add_children",
            **_add_kwargs(db_session),
        )

    target_children = result.editor_doc["root"]["children"][0]["children"]
    # Empty intermediate buckets are dropped; unassigned children go to 待归类.
    assert [child["data"]["text"] for child in target_children] == [
        "主类",
        service.AI_SPLIT_FALLBACK_BUCKET,
    ]
    assert [child["data"]["text"] for child in target_children[0]["children"]] == ["已有子节点一"]
    assert [child["data"]["text"] for child in target_children[1]["children"]] == [
        "已有子节点二",
        "已有子节点三",
    ]
    assert result.generated_children_count == 2
    assert result.reassigned_existing_children_count == 3


def test_add_children_recovers_from_replacement_nodes_payload(db_session: Session):
    """When model wrongly returns replacement_nodes (composition schema), still build groups."""
    editor_doc = _build_editor_doc()
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "replacement_nodes": [
                {
                    "text": "目的",
                    "children": [
                        {"text": "已有子节点一", "uid": "child-1", "children": []},
                        {"text": "已有子节点二", "uid": "child-2", "children": []},
                    ],
                },
                {
                    "text": "内容",
                    "children": [
                        {"text": "已有子节点三", "uid": "child-3", "children": []},
                    ],
                },
            ]
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            split_mode="add_children",
            **_add_kwargs(db_session),
        )
    groups = result.editor_doc["root"]["children"][0]["children"]
    assert [g["data"]["text"] for g in groups] == ["目的", "内容"]
    assert groups[0]["children"][0]["data"]["uid"] == "child-1"
    assert groups[1]["children"][0]["data"]["uid"] == "child-3"


def test_add_children_truncates_excess_new_categories(db_session: Session):
    editor_doc = _build_editor_doc()
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "new_children": [
                {"id": "category_1", "text": "A"},
                {"id": "category_2", "text": "B"},
                {"id": "category_3", "text": "C"},
                {"id": "category_4", "text": "D"},
            ],
            "child_assignments": [
                {"source_ref": "uid:child-1", "target_new_child_id": "category_1"},
                {"source_ref": "uid:child-2", "target_new_child_id": "category_2"},
                {"source_ref": "uid:child-3", "target_new_child_id": "category_1"},
            ],
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            _get_palace(db_session),
            editor_doc,
            "target-1",
            split_mode="add_children",
            **_add_kwargs(db_session),
        )
    # 3 existing children → at most 2 intermediate groups.
    labels = [child["data"]["text"] for child in result.editor_doc["root"]["children"][0]["children"]]
    assert labels == ["A", "B"]
    assert result.replacement_node_count == 2


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
            split_mode="add_children",
            **_add_kwargs(db_session),
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

    def fake_call(*, config, **_kwargs):
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
            split_mode="add_children",
            **_add_kwargs(db_session),
        )

    children = result.editor_doc["root"]["children"][0]["children"]
    assert [child["data"]["text"] for child in children] == ["学习组1", "学习组2", "学习组3", "学习组4"]
    assert result.generated_children_count == 4
    assert result.reassigned_existing_children_count == 10


def test_config_falls_back_to_environment_credentials(db_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", "env-key")
    monkeypatch.setattr(service, "DASHSCOPE_BASE_URL", "https://example.test/v1")
    monkeypatch.setattr(service, "DASHSCOPE_TEXT_MODEL", "qwen-env")

    config = service.resolve_mindmap_ai_split_config(
        db_session,
        ai_runtime=_ai_runtime(db_session),
    )

    assert config.api_key == "env-key"
    assert config.base_url == "https://example.test/v1"
    assert config.model == "qwen3.6-flash"
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


def _build_leaf_replacement_doc() -> dict:
    return {
        "root": {
            "data": {"text": "测试宫殿", "memoryAnkiRootKind": "palace"},
            "children": [
                {"data": {"text": "前置节点", "uid": "before"}, "children": []},
                {
                    "data": {
                        "text": "长内容：定义、条件、例子和结论",
                        "note": "必须保留限定条件",
                        "uid": "target-leaf",
                    },
                    "children": [],
                },
                {"data": {"text": "后置节点", "uid": "after"}, "children": []},
            ],
        }
    }


def test_auto_replacement_preserves_sibling_order_and_operation_identity(db_session: Session):
    palace = _get_palace(db_session)
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "replacement_nodes": [
                {"text": "定义与条件", "children": []},
                {"text": "例子与结论", "children": []},
            ]
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="auto",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-auto",
        )

    children = result.editor_doc["root"]["children"]
    assert [item["data"]["text"] for item in children] == [
        "前置节点",
        "定义与条件",
        "例子与结论",
        "后置节点",
    ]
    assert result.split_mode == "auto"
    assert result.replacement_node_count == 2
    assert result.replacement_nodes is not None
    assert len(result.replacement_nodes) == 2
    assert result.replacement_nodes[0]["data"]["text"] == "定义与条件"
    assert result.operation_id == "operation-auto"
    assert result.owner_id == f"palace:{palace.id}"
    assert str(children[1]["data"]["uid"]).startswith("ai-split-")
    assert children[1]["data"]["uid"] != "target-leaf"


def test_auto_replacement_accepts_bounded_tree(db_session: Session):
    palace = _get_palace(db_session)
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "replacement_nodes": [
                {
                    "text": "核心概念",
                    "children": [
                        {"text": "定义", "children": []},
                        {"text": "限定条件", "children": []},
                    ],
                }
            ]
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="auto",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-hierarchy",
        )

    replacement = result.editor_doc["root"]["children"][1]
    assert replacement["data"]["text"] == "核心概念"
    assert [item["data"]["text"] for item in replacement["children"]] == ["定义", "限定条件"]


def test_replacement_modes_reject_root_non_leaf_and_stale_owner(db_session: Session):
    palace = _get_palace(db_session)
    base_kwargs = {
        "ai_runtime": _ai_runtime(db_session),
        "prompt_catalog": _prompt_catalog(db_session),
        "split_mode": "auto",
        "owner_id": f"palace:{palace.id}",
        "operation_id": "operation-safe",
    }
    with pytest.raises(service.MindMapAiSplitError, match="根节点"):
        service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            None,
            **base_kwargs,
        )
    with pytest.raises(service.MindMapAiSplitError, match="只支持没有子节点"):
        service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_editor_doc(),
            "target-1",
            **base_kwargs,
        )
    with pytest.raises(service.MindMapAiSplitError, match="所属宫殿"):
        service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            **{**base_kwargs, "owner_id": "palace:other"},
        )


def test_auto_mode_accepts_nested_model_result(db_session: Session):
    palace = _get_palace(db_session)
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "replacement_nodes": [
                {"text": "合法嵌套", "children": [{"text": "子节点", "children": []}]}
            ]
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="auto",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-nested",
        )
    replacement = result.editor_doc["root"]["children"][1]
    assert replacement["data"]["text"] == "合法嵌套"
    assert replacement["children"][0]["data"]["text"] == "子节点"


def test_parallel_mode_flattens_nested_children(db_session: Session):
    palace = _get_palace(db_session)
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={
            "replacement_nodes": [
                {
                    "text": "主题",
                    "children": [
                        {"text": "要点一", "children": []},
                        {"text": "要点二", "children": []},
                    ],
                }
            ]
        },
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="parallel",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-parallel",
        )

    children = result.editor_doc["root"]["children"]
    assert [item["data"]["text"] for item in children] == [
        "前置节点",
        "主题",
        "要点一",
        "要点二",
        "后置节点",
    ]
    for item in children[1:4]:
        assert item["children"] == []
    assert result.split_mode == "parallel"


def test_target_card_count_passed_to_model_and_raises_cap(db_session: Session):
    palace = _get_palace(db_session)
    captured: dict = {}

    def fake_call(**kwargs):
        captured.update(kwargs)
        return {
            "replacement_nodes": [
                {"text": "一", "children": []},
                {"text": "二", "children": []},
                {"text": "三", "children": []},
            ]
        }

    with patch.object(service, "_call_mindmap_ai_split_model", side_effect=fake_call):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="auto",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-count",
            target_card_count=3,
        )

    assert captured.get("target_card_count") == 3
    assert result.replacement_node_count == 3
    # Soft target 3 → prompt max_children at least 3 (typically 3+2 headroom), not a reject bar
    assert captured["config"].max_children >= 3


def test_auto_accepts_more_top_level_than_inferred_soft_preference(db_session: Session):
    """Short leaf would infer ~2 top-level; model may return more — still previewable."""
    palace = _get_palace(db_session)
    five_nodes = [{"text": f"要点{i}", "children": []} for i in range(1, 6)]
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={"replacement_nodes": five_nodes},
    ):
        result = service.split_palace_editor_doc_with_ai(
            db_session,
            palace,
            _build_leaf_replacement_doc(),
            "target-leaf",
            ai_runtime=_ai_runtime(db_session),
            prompt_catalog=_prompt_catalog(db_session),
            split_mode="auto",
            owner_id=f"palace:{palace.id}",
            operation_id="operation-soft-top",
            # card count auto → soft preference only
            target_card_count=None,
        )

    assert result.replacement_node_count == 5
    assert result.replacement_nodes is not None
    assert [node["data"]["text"] for node in result.replacement_nodes] == [
        "要点1",
        "要点2",
        "要点3",
        "要点4",
        "要点5",
    ]
    children = result.editor_doc["root"]["children"]
    assert [item["data"]["text"] for item in children] == [
        "前置节点",
        "要点1",
        "要点2",
        "要点3",
        "要点4",
        "要点5",
        "后置节点",
    ]


def test_auto_rejects_only_safety_top_level_cap(db_session: Session):
    palace = _get_palace(db_session)
    # Safety cap is AI_SPLIT_VALIDATION_MAX_TOP_LEVEL (12); 13 top-level nodes must fail.
    too_many = [{"text": f"卡{i}", "children": []} for i in range(1, 14)]
    with patch.object(
        service,
        "_call_mindmap_ai_split_model",
        return_value={"replacement_nodes": too_many},
    ):
        with pytest.raises(service.MindMapAiSplitError, match="顶层节点超过限制"):
            service.split_palace_editor_doc_with_ai(
                db_session,
                palace,
                _build_leaf_replacement_doc(),
                "target-leaf",
                ai_runtime=_ai_runtime(db_session),
                prompt_catalog=_prompt_catalog(db_session),
                split_mode="auto",
                owner_id=f"palace:{palace.id}",
                operation_id="operation-safety-top",
            )


def test_ai_split_prompt_scenes_compile_with_required_blocks(db_session: Session):
    catalog = _prompt_catalog(db_session)
    unified = catalog.compose("ai_split")
    parallel_alias = catalog.compose("ai_split_parallel")
    hierarchy_alias = catalog.compose("ai_split_hierarchy")

    required = {
        "role.strict_json",
        "content.split_source_fidelity",
        "task.split_structure_judgment",
        "task.split_examples",
        "boundary.split_in_place",
        "output.mindmap_split_json",
    }
    assert required.issubset(set(unified.block_keys))
    assert required.issubset(set(parallel_alias.block_keys))
    assert required.issubset(set(hierarchy_alias.block_keys))
    assert "replacement_nodes" in unified.text
    assert "保留原句" in unified.text
    assert "实科中学" in unified.text
    assert "骑士学院" in unified.text
    assert "最多四层" in unified.text


def test_scene_runtime_model_wins_over_stale_legacy_split_model(db_session: Session):
    db_session.add_all(
        [
            Config(key="mindmap_ai_split_model", value="qwen3.6-flash"),
            Config(key="deepseek_api_key", value="test-deepseek-key"),
            Config(key="deepseek_base_url", value="https://api.deepseek.test"),
            Config(key="scene_model_ai_split", value="deepseek-v4-flash"),
        ]
    )
    db_session.commit()

    config = service.resolve_mindmap_ai_split_config(
        db_session,
        ai_runtime=_ai_runtime(db_session),
    )

    assert config.provider == "deepseek"
    assert config.model == "deepseek-v4-flash"
