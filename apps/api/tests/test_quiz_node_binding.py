"""Unit/integration tests for palace quiz ↔ mindmap node binding (shipped paths)."""

from __future__ import annotations

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.application._question_utils import PalaceQuizAiError
from memory_anki.modules.quiz.application.node_binding import (
    _merge_preview_bindings,
    _parse_binding_response,
    auto_bind_palace_questions_by_text,
    compact_mindmap_with_uids,
    list_palace_node_bindings,
    list_question_node_bindings,
    mutate_quiz_node_bindings,
    search_mindmap_nodes,
)


def _mindmap_doc(*pairs: tuple[str, str]) -> dict:
    children = [
        {"data": {"uid": uid, "text": text}, "children": []} for uid, text in pairs
    ]
    return {
        "root": {
            "data": {"uid": "root", "text": "根"},
            "children": children,
        }
    }


def _add_palace(session, *, title: str, nodes: list[tuple[str, str]]) -> Palace:
    palace = Palace(
        title=title,
        editor_doc=json.dumps(_mindmap_doc(*nodes), ensure_ascii=False),
        editor_config="{}",
    )
    session.add(palace)
    session.flush()
    return palace


def _add_question(session, *, palace_id: int, stem: str) -> PalaceQuizQuestion:
    row = PalaceQuizQuestion(
        palace_id=palace_id,
        question_type="multiple_choice",
        stem=stem,
        options_json='[{"id":"A","text":"a"},{"id":"B","text":"b"}]',
        answer_payload_json='{"correct_option_id":"A"}',
        analysis="解析",
        lifecycle_status="published",
    )
    session.add(row)
    session.flush()
    return row


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


def test_cross_palace_mutate_unique_identity_and_reverse_list(db_session) -> None:
    palace_a = _add_palace(db_session, title="宫殿A", nodes=[("node-a", "突触传递")])
    palace_b = _add_palace(db_session, title="宫殿B", nodes=[("node-b", "受体分型"), ("shared-uid", "同uid本宫")])
    # Same node_uid string on A as on B — unique key must include target palace.
    palace_a.editor_doc = json.dumps(
        _mindmap_doc(("shared-uid", "同uid他宫"), ("node-a", "突触传递")),
        ensure_ascii=False,
    )
    db_session.flush()
    question = _add_question(db_session, palace_id=int(palace_a.id), stem="关于受体分型的题目")
    db_session.commit()

    # Bind owner-A question onto B's node (cross-palace edge).
    result = mutate_quiz_node_bindings(
        db_session,
        palace_id=int(palace_b.id),
        add=[
            {
                "question_id": int(question.id),
                "node_uid": "node-b",
                "reason": "cross",
            }
        ],
        remove=[],
    )
    assert result["created_count"] == 1

    # Same uid on different palaces must not collide.
    result2 = mutate_quiz_node_bindings(
        db_session,
        palace_id=int(palace_a.id),
        add=[
            {
                "question_id": int(question.id),
                "node_uid": "shared-uid",
                "reason": "local",
            }
        ],
        remove=[],
    )
    assert result2["created_count"] == 1

    reverse_b = list_palace_node_bindings(db_session, int(palace_b.id))
    assert len(reverse_b) == 1
    edge = reverse_b[0]
    assert edge["question_id"] == int(question.id)
    assert edge["palace_id"] == int(palace_b.id)
    assert edge["target_palace_id"] == int(palace_b.id)
    assert edge["question_owner_palace_id"] == int(palace_a.id)
    assert edge["is_cross_palace"] is True
    assert edge["node_uid"] == "node-b"

    per_question = list_question_node_bindings(db_session, int(question.id))
    assert {item["node_uid"] for item in per_question} == {"node-b", "shared-uid"}
    assert any(item["target_palace_id"] == int(palace_b.id) for item in per_question)

    # Unique identity includes target palace: two rows with same question+uid different palace.
    rows = (
        db_session.query(PalaceQuizQuestionNodeBinding)
        .filter(PalaceQuizQuestionNodeBinding.question_id == int(question.id))
        .all()
    )
    assert len(rows) == 2
    assert {(int(r.palace_id), str(r.node_uid)) for r in rows} == {
        (int(palace_b.id), "node-b"),
        (int(palace_a.id), "shared-uid"),
    }

    # Remove cross edge via target palace mutate.
    removed = mutate_quiz_node_bindings(
        db_session,
        palace_id=int(palace_b.id),
        add=[],
        remove=[{"question_id": int(question.id), "node_uid": "node-b"}],
    )
    assert removed["removed_count"] == 1
    assert list_palace_node_bindings(db_session, int(palace_b.id)) == []


def test_auto_bind_text_overlap_writes_edges(db_session) -> None:
    palace = _add_palace(
        db_session,
        title="细胞",
        nodes=[("n-mito", "线粒体功能"), ("n-other", "无关节点")],
    )
    _add_question(db_session, palace_id=int(palace.id), stem="线粒体功能是什么")
    db_session.commit()

    result = auto_bind_palace_questions_by_text(
        db_session,
        palace_id=int(palace.id),
        fill_unbound_only=True,
        max_nodes_per_question=2,
    )
    assert result["created_count"] >= 1
    items = list_palace_node_bindings(db_session, int(palace.id))
    assert any(item["node_uid"] == "n-mito" for item in items)


def test_search_mindmap_nodes_finds_text(db_session) -> None:
    palace = _add_palace(db_session, title="搜", nodes=[("n1", "兴奋性突触后电位")])
    db_session.commit()
    hits = search_mindmap_nodes(db_session, query="突触后", limit=10)
    assert any(hit["node_uid"] == "n1" and hit["palace_id"] == int(palace.id) for hit in hits)
