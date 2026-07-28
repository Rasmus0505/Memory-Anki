"""Pure mind-map split topology shared by scheduling and freestyle queues.

放在 `mindmap_document`（零依赖的纯文档上下文）是因为 `memory` 与 `practice`
都需要它：context-map 禁止 `memory -> practice`，而 `check_review_application_boundary`
另外禁止 `memory/application -> content`。这里只有纯树拓扑，无调度语义、
无队列语义、无持久化。

**倒水模型**：从宫殿根往下浇水。水流经未标记节点不截流；碰到永久标记时，
标记节点及其下游被隔离成独立单元，直到下一个更深的永久标记。所有没有落入
标记区域的节点共同组成根部剩余水流单元。永久标记只负责隔离，不负责选择
复习范围；宫殿只要存在至少一个永久标记，所有非根节点都必须且只属于一个
复习单元。

`split_scheduling_units` 是唯一单元拓扑函数。Reviews 持久化并调和它的结果；
正式复习与随心队列都只消费 Reviews 的公共单元投影，不自行再次切分。
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

UNIT_KIND_PALACE = "palace"
UNIT_KIND_MARK = "mark"
UNIT_KIND_RESIDUAL = "residual"


@dataclass(frozen=True)
class SplitUnit:
    """A scheduling-grade split unit (one palace, or one permanent-mark region)."""

    unit_root_uid: str
    kind: str
    title: str
    node_uids: tuple[str, ...]  # 文档 DFS 先序
    folded_ancestor_uids: tuple[str, ...] = ()


def subtree_uids(
    nodes: Mapping[str, Mapping[str, Any]],
    branch_uid: str,
    *,
    include_self: bool = True,
) -> list[str]:
    """DFS preorder uids under ``branch_uid``."""
    if branch_uid not in nodes:
        return []
    result: list[str] = [branch_uid] if include_self else []
    stack = list(nodes[branch_uid].get("children") or [])
    while stack:
        current = stack.pop(0)
        if current not in nodes:
            continue
        result.append(current)
        stack[0:0] = list(nodes[current].get("children") or [])
    return result


def ancestor_path(
    nodes: Mapping[str, Mapping[str, Any]],
    uid: str,
    *,
    include_root: bool = True,
) -> list[dict[str, str]]:
    path: list[dict[str, str]] = []
    current = nodes.get(uid, {}).get("parent_uid")
    while current and current in nodes:
        path.append({"uid": str(current), "text": str(nodes[current].get("text") or "")})
        parent = nodes[current].get("parent_uid")
        if parent is None and not include_root:
            path.pop()
            break
        current = parent
    path.reverse()
    return path


def is_descendant(
    nodes: Mapping[str, Mapping[str, Any]],
    uid: str,
    ancestor: str,
) -> bool:
    """True when ``uid`` is a proper descendant of ``ancestor``."""
    if uid == ancestor or uid not in nodes or ancestor not in nodes:
        return False
    current = nodes[uid].get("parent_uid")
    while current and current in nodes:
        if current == ancestor:
            return True
        current = nodes[current].get("parent_uid")
    return False


def node_depth(
    nodes: Mapping[str, Mapping[str, Any]],
    uid: str,
    *,
    root_uid: str | None,
) -> int:
    depth = 0
    current = uid
    seen: set[str] = set()
    while current and current in nodes and current != root_uid:
        if current in seen:
            break
        seen.add(current)
        parent = nodes[current].get("parent_uid")
        if parent is None:
            break
        depth += 1
        current = parent
    return depth


def mark_region_uids(
    nodes: Mapping[str, Mapping[str, Any]],
    mark_uid: str,
    mark_anchors: set[str],
) -> list[str]:
    """Nodes owned by ``mark_uid`` under the water-pour model.

    Pour from the mark downward: keep every descendant until (but not into) a
    deeper mark. Deeper mark subtrees are carved out as their own units.
    """
    full = subtree_uids(nodes, mark_uid, include_self=True)
    if not full:
        return []
    exclude: set[str] = set()
    full_set = set(full)
    for other in mark_anchors:
        if other == mark_uid or other not in full_set:
            continue
        if not is_descendant(nodes, other, mark_uid):
            continue
        exclude.update(subtree_uids(nodes, other, include_self=True))
    return [uid for uid in full if uid not in exclude]


def path_ancestors(
    nodes: Mapping[str, Mapping[str, Any]],
    uid: str,
    *,
    root_uid: str | None,
) -> list[str]:
    """Rootward → leafward ancestors excluding the palace root and ``uid``."""
    path: list[str] = []
    current = nodes.get(uid, {}).get("parent_uid")
    while current and current in nodes:
        path.append(str(current))
        if current == root_uid:
            break
        current = nodes[current].get("parent_uid")
    path.reverse()
    return [p for p in path if p != root_uid]


def iter_mark_regions(
    nodes: Mapping[str, Mapping[str, Any]],
    *,
    root_uid: str,
    mark_uids: set[str],
    claimed: set[str] | None = None,
) -> Iterator[tuple[str, list[str], tuple[str, ...]]]:
    """Water-pour phase 1: yield ``(mark_uid, ordered_region, folded_ancestors)``.

    Shallow marks are processed first so the outer residual claims before inner
    ones. ``claimed`` is mutated as regions are handed out (first claim wins),
    letting callers keep their own accounting in the same pass.
    """
    owned = claimed if claimed is not None else set()
    marks_ordered = sorted(
        mark_uids,
        key=lambda uid: (node_depth(nodes, uid, root_uid=root_uid), uid),
    )
    for mark_uid in marks_ordered:
        region = [
            uid
            for uid in mark_region_uids(nodes, mark_uid, mark_uids)
            if uid not in owned and uid in nodes
        ]
        if not region:
            continue
        folded = tuple(
            uid
            for uid in path_ancestors(nodes, mark_uid, root_uid=root_uid)
            if uid not in owned and uid in nodes
        )
        region_set = set(region)
        ordered_region = [
            uid
            for uid in subtree_uids(nodes, mark_uid, include_self=True)
            if uid in region_set
        ]
        ordered_region.extend(
            uid for uid in region if uid not in set(ordered_region)
        )
        yield mark_uid, ordered_region, folded
        owned.update(folded)
        owned.update(ordered_region)


def permanent_mark_uids_from_nodes(
    nodes: Mapping[str, Mapping[str, Any]],
    *,
    root_uid: str | None = None,
) -> set[str]:
    """Collect ``permanent_split_mark`` anchors from a projected tree."""
    marks = {
        str(uid)
        for uid, node in nodes.items()
        if node.get("permanent_split_mark") is True
    }
    return marks


def split_scheduling_units(
    *,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    permanent_mark_uids: Sequence[str] | set[str] | None = None,
) -> list[SplitUnit]:
    """Split one palace into permanent-mark isolation units.

    No permanent mark means no review units. A root mark makes the root water
    flow itself a unit; deeper marks are carved out from it. Without a root
    mark, every marked region is carved out and all remaining nodes form one
    residual root unit. Unmarked ancestors never fold into an arbitrary marked
    unit.
    """
    if not root_uid or root_uid not in nodes:
        return []
    root = str(root_uid)

    def _title(uid: str) -> str:
        return str(nodes.get(uid, {}).get("text") or "")

    marks = {str(uid) for uid in (permanent_mark_uids or []) if str(uid) in nodes}
    all_non_root = [uid for uid in subtree_uids(nodes, root, include_self=True) if uid != root]
    if not marks:
        return []

    preorder = subtree_uids(nodes, root, include_self=True)
    preorder_index = {uid: index for index, uid in enumerate(preorder)}
    ordered_marks = sorted(
        marks,
        key=lambda uid: (
            node_depth(nodes, uid, root_uid=root),
            preorder_index.get(uid, 10**9),
        ),
    )
    claimed: set[str] = set()
    units: list[SplitUnit] = []
    for mark_uid in ordered_marks:
        members = tuple(
            uid for uid in mark_region_uids(nodes, mark_uid, marks) if uid != root
        )
        if not members:
            continue
        units.append(
            SplitUnit(
                unit_root_uid=mark_uid,
                kind=UNIT_KIND_PALACE if mark_uid == root else UNIT_KIND_MARK,
                title=_title(mark_uid),
                node_uids=members,
            )
        )
        claimed.update(members)

    residual = tuple(uid for uid in all_non_root if uid not in claimed)
    if residual:
        units.append(
            SplitUnit(
                unit_root_uid=root,
                kind=UNIT_KIND_RESIDUAL,
                title=_title(root),
                node_uids=residual,
            )
        )
    return units
