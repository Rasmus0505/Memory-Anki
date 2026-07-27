"""调度单元切分：宫殿整体，永久标记切分，残余归并。"""

from __future__ import annotations

import json

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.application.scheduling.units import (
    default_unit_root_uid,
    invalidate_units_cache,
    resolve_units,
    unit_of_node,
)
from memory_anki.modules.mindmap_document.api import (
    UNIT_KIND_MARK,
    UNIT_KIND_PALACE,
    UNIT_KIND_RESIDUAL,
    permanent_mark_uids_from_nodes,
    split_scheduling_units,
)


def _node(uid, text, children=(), mark=False):
    data = {"uid": uid, "text": text}
    if mark:
        data["permanentSplitMark"] = True
    return {"data": data, "children": list(children)}


def _palace(session, children):
    palace = Palace(
        title="Units", description="", difficulty=0, review_mode="review",
        editor_doc=json.dumps({"root": _node("root", "root", children)}),
    )
    session.add(palace)
    session.commit()
    return palace


def _tree(children):
    from memory_anki.modules.content.application.tree_structure import (
        build_tree_from_editor_doc,
    )

    return build_tree_from_editor_doc({"root": _node("root", "root", children)})


def _split(nodes, root_uid):
    return split_scheduling_units(
        nodes=nodes,
        root_uid=root_uid,
        permanent_mark_uids=permanent_mark_uids_from_nodes(nodes, root_uid=root_uid),
    )


def test_palace_without_marks_is_one_unit():
    """无永久标记 → 整个宫殿一个调度单元（不按一级分支拆开）。"""
    root_uid, nodes = _tree(
        [
            _node("a", "A", [_node("a1", "A1"), _node("a2", "A2")]),
            _node("b", "B", [_node("b1", "B1")]),
            _node("c", "C"),
        ]
    )
    units = _split(nodes, root_uid)
    assert len(units) == 1
    unit = units[0]
    assert unit.kind == UNIT_KIND_PALACE
    assert unit.unit_root_uid == "root"
    # 文档 DFS 先序，根不入单元。
    assert unit.node_uids == ("a", "a1", "a2", "b", "b1", "c")


def test_permanent_marks_split_into_mark_units_plus_residual():
    """倒水模型：标记起单元含自身+后代直到更深标记；残余区独立成单元。"""
    root_uid, nodes = _tree(
        [
            _node("a", "A", [_node("a1", "A1"), _node("a2", "A2")], mark=True),
            _node("b", "B", [_node("b1", "B1")]),
        ]
    )
    units = {u.unit_root_uid: u for u in _split(nodes, root_uid)}
    assert set(units) == {"a", "root"}
    assert units["a"].kind == UNIT_KIND_MARK
    assert units["a"].node_uids == ("a", "a1", "a2")
    assert units["root"].kind == UNIT_KIND_RESIDUAL
    assert units["root"].node_uids == ("b", "b1")


def test_nested_marks_carve_out_inner_subtree():
    """L2 标记从 L1 单元里挖出自己的子树；未标记祖先折叠进最先认领的单元。"""
    root_uid, nodes = _tree(
        [
            _node(
                "a", "A",
                [
                    _node("a1", "A1", [_node("a1x", "A1x")], mark=True),
                    _node("a2", "A2"),
                ],
                mark=True,
            ),
        ]
    )
    units = {u.unit_root_uid: u for u in _split(nodes, root_uid)}
    assert set(units) == {"a", "a1"}
    assert set(units["a"].node_uids) == {"a", "a2"}
    assert set(units["a1"].node_uids) == {"a1", "a1x"}


def test_every_non_root_node_lands_in_exactly_one_unit():
    root_uid, nodes = _tree(
        [
            _node("a", "A", [_node("a1", "A1", [_node("a1x", "A1x")], mark=True)]),
            _node("b", "B", [_node("b1", "B1")], mark=True),
            _node("c", "C"),
        ]
    )
    units = _split(nodes, root_uid)
    seen: list[str] = []
    for unit in units:
        seen.extend(unit.node_uids)
    assert sorted(seen) == sorted(uid for uid in nodes if uid != root_uid)
    assert len(seen) == len(set(seen))  # 无重复认领


def test_resolve_units_reads_marks_from_editor_doc(db_session):
    palace = _palace(
        db_session,
        [
            _node("a", "A", [_node("a1", "A1")], mark=True),
            _node("b", "B"),
        ],
    )
    units = resolve_units(db_session, palace.id)
    assert set(units) == {"a", "root"}
    assert unit_of_node(db_session, palace.id, "a1").unit_root_uid == "a"
    assert unit_of_node(db_session, palace.id, "b").unit_root_uid == "root"
    assert unit_of_node(db_session, palace.id, "missing") is None


def test_default_unit_is_whole_palace_without_marks(db_session):
    palace = _palace(db_session, [_node("a", "A"), _node("b", "B")])
    assert default_unit_root_uid(db_session, palace.id) == "root"
    units = resolve_units(db_session, palace.id)
    assert units["root"].node_count == 2


def test_units_cache_invalidates_on_document_change(db_session):
    palace = _palace(db_session, [_node("a", "A", [_node("a1", "A1")])])
    assert set(resolve_units(db_session, palace.id)) == {"root"}

    palace.editor_doc = json.dumps(
        {"root": _node("root", "root", [_node("a", "A", [_node("a1", "A1")], mark=True)])}
    )
    db_session.commit()
    # 缓存未失效时仍是旧结果——这正是需要显式失效的原因。
    assert set(resolve_units(db_session, palace.id)) == {"root"}
    invalidate_units_cache(db_session, palace.id)
    assert set(resolve_units(db_session, palace.id)) == {"a"}
