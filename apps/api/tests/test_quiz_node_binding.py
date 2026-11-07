"""Unit/integration tests for palace quiz ↔ mindmap node binding (shipped paths)."""

from __future__ import annotations

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.quiz.application.node_binding import (
    DEFAULT_ROOT_BINDING_REASON,
    REMOVED_NODE_ROOT_REASON,
    auto_bind_palace_questions_by_text,
    compact_mindmap_with_uids,
    list_palace_node_bindings,
    list_question_node_bindings,
    mutate_quiz_node_bindings,
    rehome_orphaned_question_bindings,
    search_mindmap_nodes,
)
from memory_anki.modules.quiz.application.question_contracts import PalaceQuizValidationError
from memory_anki.modules.quiz.application.questions.commands import create_question


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


def test_cross_palace_mutate_is_rejected_and_owner_palace_binds(db_session) -> None:
    palace_a = _add_palace(db_session, title="宫殿A", nodes=[("node-a", "突触传递")])
    palace_b = _add_palace(db_session, title="宫殿B", nodes=[("node-b", "受体分型"), ("shared-uid", "同uid本宫")])
    # Same node_uid string on A as on B must not collide across palaces.
    palace_a.editor_doc = json.dumps(
        _mindmap_doc(("shared-uid", "同uid他宫"), ("node-a", "突触传递")),
        ensure_ascii=False,
    )
    db_session.flush()
    question = _add_question(db_session, palace_id=int(palace_a.id), stem="关于受体分型的题目")
    db_session.commit()

    # A question belongs to palace A, so binding it into B is refused outright.
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
    assert result["created_count"] == 0
    assert list_palace_node_bindings(db_session, int(palace_b.id)) == []

    # The same question binds normally inside its own palace.
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

    owned = list_palace_node_bindings(db_session, int(palace_a.id))
    assert len(owned) == 1
    edge = owned[0]
    assert edge["question_id"] == int(question.id)
    assert edge["palace_id"] == int(palace_a.id)
    assert edge["target_palace_id"] == int(palace_a.id)
    assert edge["question_owner_palace_id"] == int(palace_a.id)
    assert edge["node_uid"] == "shared-uid"
    assert edge["question_type"] == "multiple_choice"
    assert edge["marked"] is False

    per_question = list_question_node_bindings(db_session, int(question.id))
    assert {item["node_uid"] for item in per_question} == {"shared-uid"}
    assert all(item["palace_id"] == int(palace_a.id) for item in per_question)

    # No cross-palace edge shape survives anywhere.
    rows = (
        db_session.query(PalaceQuizQuestionNodeBinding)
        .filter(PalaceQuizQuestionNodeBinding.question_id == int(question.id))
        .all()
    )
    assert {(int(r.palace_id), str(r.node_uid)) for r in rows} == {(int(palace_a.id), "shared-uid")}

    # Removing from the foreign palace is a no-op: the edge never existed there.
    removed = mutate_quiz_node_bindings(
        db_session,
        palace_id=int(palace_b.id),
        add=[],
        remove=[{"question_id": int(question.id), "node_uid": "node-b"}],
    )
    assert removed["removed_count"] == 0
    assert list_palace_node_bindings(db_session, int(palace_b.id)) == []

    # The owning palace can remove its own edge.
    removed_local = mutate_quiz_node_bindings(
        db_session,
        palace_id=int(palace_a.id),
        add=[],
        remove=[{"question_id": int(question.id), "node_uid": "shared-uid"}],
    )
    assert removed_local["removed_count"] == 1
    assert list_palace_node_bindings(db_session, int(palace_a.id)) == []


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
    # Search is palace-scoped: without a palace_id there is no valid target.
    assert search_mindmap_nodes(db_session, query="突触后", limit=10) == []
    hits = search_mindmap_nodes(db_session, query="突触后", palace_id=int(palace.id), limit=10)
    assert any(hit["node_uid"] == "n1" and hit["palace_id"] == int(palace.id) for hit in hits)


def test_create_question_defaults_root_node_binding(db_session) -> None:
    palace = _add_palace(db_session, title="默认根绑定", nodes=[("leaf-a", "叶节点")])
    db_session.commit()

    created = create_question(
        db_session,
        int(palace.id),
        {
            "question_type": "multiple_choice",
            "stem": "无显式节点绑定时应落到根？",
            "options": [
                {"id": "A", "text": "是"},
                {"id": "B", "text": "否"},
            ],
            "answer_payload": {"correct_option_id": "A"},
            "analysis": "默认根",
        },
        commit=True,
    )
    bindings = list_question_node_bindings(db_session, int(created["id"]))
    assert len(bindings) >= 1
    assert any(item["node_uid"] == "root" for item in bindings)
    root_edge = next(item for item in bindings if item["node_uid"] == "root")
    assert root_edge["reason"] == DEFAULT_ROOT_BINDING_REASON
    assert root_edge["source"] == "manual"
    assert root_edge["target_palace_id"] == int(palace.id)


def test_create_question_uses_explicit_node_uids(db_session) -> None:
    palace = _add_palace(
        db_session,
        title="显式绑定",
        nodes=[("leaf-a", "A"), ("leaf-b", "B")],
    )
    db_session.commit()

    created = create_question(
        db_session,
        int(palace.id),
        {
            "question_type": "short_answer",
            "stem": "显式绑定叶节点",
            "answer_payload": {"reference_answer": "A"},
            "analysis": "显式",
            "node_uids": ["leaf-b", "leaf-a"],
        },
        commit=True,
    )
    bindings = list_question_node_bindings(db_session, int(created["id"]))
    assert {item["node_uid"] for item in bindings} == {"leaf-a", "leaf-b"}
    assert all(item["source"] == "manual" for item in bindings)
    assert all(item["question_type"] == "short_answer" for item in bindings)
    assert all(item["marked"] is False for item in bindings)
    assert not any(item["node_uid"] == "root" for item in bindings)


def test_create_question_rejects_unknown_node_uids(db_session) -> None:
    palace = _add_palace(db_session, title="校验UID", nodes=[("leaf-a", "A")])
    db_session.commit()

    with pytest.raises(PalaceQuizValidationError):
        create_question(
            db_session,
            int(palace.id),
            {
                "question_type": "short_answer",
                "stem": "未知节点应失败",
                "answer_payload": {"reference_answer": "x"},
                "analysis": "fail",
                "node_uids": ["missing-uid"],
            },
            commit=True,
        )


def _add_binding(
    session,
    *,
    palace_id: int,
    question_id: int,
    node_uid: str,
) -> PalaceQuizQuestionNodeBinding:
    row = PalaceQuizQuestionNodeBinding(
        palace_id=palace_id,
        question_id=question_id,
        node_uid=node_uid,
        reason="手动绑定",
        source="manual",
    )
    session.add(row)
    session.flush()
    return row


def test_deleted_child_binding_falls_back_to_root(db_session) -> None:
    palace = _add_palace(db_session, title="细胞", nodes=[("n-child", "线粒体")])
    question = _add_question(db_session, palace_id=int(palace.id), stem="线粒体功能")
    _add_binding(
        db_session,
        palace_id=int(palace.id),
        question_id=int(question.id),
        node_uid="n-child",
    )
    db_session.commit()

    result = rehome_orphaned_question_bindings(
        db_session,
        palace_id=int(palace.id),
        editor_doc=_mindmap_doc(),
    )
    db_session.commit()

    assert result == {"rehomed": 1, "dropped": 0}
    bindings = list_question_node_bindings(db_session, int(question.id))
    assert [(item["node_uid"], item["reason"]) for item in bindings] == [
        ("root", REMOVED_NODE_ROOT_REASON)
    ]


def test_stale_edge_is_dropped_when_question_still_bound(db_session) -> None:
    palace = _add_palace(db_session, title="细胞", nodes=[("n-child", "线粒体"), ("n-live", "叶绿体")])
    question = _add_question(db_session, palace_id=int(palace.id), stem="细胞器")
    _add_binding(
        db_session,
        palace_id=int(palace.id),
        question_id=int(question.id),
        node_uid="n-child",
    )
    _add_binding(
        db_session,
        palace_id=int(palace.id),
        question_id=int(question.id),
        node_uid="n-live",
    )
    db_session.commit()

    result = rehome_orphaned_question_bindings(
        db_session,
        palace_id=int(palace.id),
        editor_doc={
            "root": {
                "data": {"uid": "root", "text": "根"},
                "children": [{"data": {"uid": "n-live", "text": "叶绿体"}, "children": []}],
            }
        },
    )
    db_session.commit()

    assert result == {"rehomed": 0, "dropped": 1}
    bindings = list_question_node_bindings(db_session, int(question.id))
    assert [item["node_uid"] for item in bindings] == ["n-live"]


def test_multiple_stale_edges_collapse_to_one_root_edge(db_session) -> None:
    palace = _add_palace(
        db_session,
        title="细胞",
        nodes=[("n-a", "线粒体"), ("n-b", "叶绿体")],
    )
    question = _add_question(db_session, palace_id=int(palace.id), stem="细胞器")
    for uid in ("n-a", "n-b"):
        _add_binding(
            db_session,
            palace_id=int(palace.id),
            question_id=int(question.id),
            node_uid=uid,
        )
    db_session.commit()

    result = rehome_orphaned_question_bindings(
        db_session,
        palace_id=int(palace.id),
        editor_doc=_mindmap_doc(),
    )
    db_session.commit()

    assert result == {"rehomed": 1, "dropped": 1}
    bindings = list_question_node_bindings(db_session, int(question.id))
    assert [item["node_uid"] for item in bindings] == ["root"]


def test_rehome_leaves_document_without_nodes_untouched(db_session) -> None:
    palace = _add_palace(db_session, title="细胞", nodes=[("n-child", "线粒体")])
    question = _add_question(db_session, palace_id=int(palace.id), stem="线粒体功能")
    _add_binding(
        db_session,
        palace_id=int(palace.id),
        question_id=int(question.id),
        node_uid="n-child",
    )
    db_session.commit()

    result = rehome_orphaned_question_bindings(
        db_session,
        palace_id=int(palace.id),
        editor_doc={},
    )
    db_session.commit()

    assert result == {"rehomed": 0, "dropped": 0}
    bindings = list_question_node_bindings(db_session, int(question.id))
    assert [item["node_uid"] for item in bindings] == ["n-child"]
