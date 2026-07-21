"""Unit tests for palace quiz ↔ mindmap node binding helpers."""

from __future__ import annotations

import pytest

from memory_anki.modules.palace_quiz.application._question_utils import PalaceQuizAiError
from memory_anki.modules.palace_quiz.application.node_binding import (
    _merge_preview_bindings,
    _parse_binding_response,
    compact_mindmap_with_uids,
)


def test_compact_mindmap_with_uids_walks_tree() -> None:
    doc = {
        "root": {
            "data": {"uid": "root", "text": "根"},
            "children": [
                {
                    "data": {"uid": "child", "text": "子节点"},
                    "children": [],
                }
            ],
        }
    }
    nodes = compact_mindmap_with_uids(doc)
    assert [item["uid"] for item in nodes] == ["root", "child"]
    assert nodes[1]["parent_uid"] == "root"
    assert nodes[1]["depth"] == 1


def test_merge_replace_all_ignores_existing() -> None:
    merged = _merge_preview_bindings(
        ai_bindings=[{"question_id": 1, "node_uids": ["a"], "reason": "r", "confidence": 0.9}],
        existing_edges=[(1, "old"), (2, "keep")],
        merge_mode="replace_all",
    )
    assert merged == [
        {
            "question_id": 1,
            "node_uid": "a",
            "reason": "r",
            "confidence": 0.9,
            "source": "ai",
        }
    ]


def test_merge_fill_unbound_keeps_existing_and_adds_new() -> None:
    merged = _merge_preview_bindings(
        ai_bindings=[
            {"question_id": 1, "node_uids": ["a"], "reason": "ignored"},
            {"question_id": 2, "node_uids": ["b"], "reason": "new"},
        ],
        existing_edges=[(1, "old")],
        merge_mode="fill_unbound",
    )
    assert {(item["question_id"], item["node_uid"], item["source"]) for item in merged} == {
        (1, "old", "existing"),
        (2, "b", "ai"),
    }


def test_parse_binding_response_filters_unknown_ids() -> None:
    text = """
    {
      "bindings": [
        {"question_id": 1, "node_uids": ["n1", "missing"], "reason": "ok", "confidence": 0.5},
        {"question_id": 99, "node_uids": ["n1"], "reason": "skip"}
      ],
      "unbound_question_ids": [2]
    }
    """
    bindings, unbound, warnings = _parse_binding_response(
        text,
        allowed_question_ids={1, 2},
        allowed_node_uids={"n1"},
    )
    assert bindings == [
        {
            "question_id": 1,
            "node_uids": ["n1"],
            "reason": "ok",
            "confidence": 0.5,
        }
    ]
    assert unbound == [2]
    assert any("未知" in item or "missing" in item or "未知节点" in item for item in warnings)


def test_parse_binding_response_rejects_invalid_json() -> None:
    with pytest.raises(PalaceQuizAiError):
        _parse_binding_response(
            "not-json",
            allowed_question_ids={1},
            allowed_node_uids={"n1"},
        )


def test_mutate_exports_present() -> None:
    from memory_anki.modules.palace_quiz.application import node_binding as module

    assert callable(module.mutate_quiz_node_bindings)
