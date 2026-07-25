"""Pure branch-unit splitting and ordering for freestyle mind-map cards."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BranchUnit:
    palace_id: int
    branch_uid: str
    context_path: tuple[dict[str, str], ...]
    ratable_node_uids: tuple[str, ...]
    node_count: int
    over_limit_delta: int
    selection_reason: str = "branch_unit"

    def as_dict(self) -> dict[str, Any]:
        return {
            "palace_id": self.palace_id,
            "branch_uid": self.branch_uid,
            "context_path": list(self.context_path),
            "ratable_node_uids": list(self.ratable_node_uids),
            "node_count": self.node_count,
            "over_limit_delta": self.over_limit_delta,
            "selection_reason": self.selection_reason,
        }


def subtree_uids(
    nodes: Mapping[str, Mapping[str, Any]],
    branch_uid: str,
    *,
    include_self: bool = True,
) -> list[str]:
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


def derive_permanent_mark_levels(
    nodes: Mapping[str, Mapping[str, Any]],
    marked_uids: Sequence[str] | set[str],
    *,
    root_uid: str | None = None,
) -> dict[str, int]:
    """Auto levels: no marked ancestor -> 1; else 1 + count of marked ancestors."""
    marked = {str(uid) for uid in marked_uids if str(uid) in nodes}
    if root_uid is not None:
        marked.discard(str(root_uid))
    levels: dict[str, int] = {}
    for uid in marked:
        count = 0
        current = nodes.get(uid, {}).get("parent_uid")
        while current and current in nodes:
            if current in marked:
                count += 1
            current = nodes[current].get("parent_uid")
        levels[uid] = 1 + count
    return levels


def filter_outermost_roots(
    nodes: Mapping[str, Mapping[str, Any]],
    root_uids: Sequence[str],
) -> list[str]:
    """Keep roots that are not descendants of another root in the same set."""
    roots = [str(uid) for uid in root_uids if str(uid) in nodes]
    root_set = set(roots)
    ordered: list[str] = []
    seen: set[str] = set()
    for uid in roots:
        if uid in seen:
            continue
        current = nodes.get(uid, {}).get("parent_uid")
        dominated = False
        while current and current in nodes:
            if current in root_set:
                dominated = True
                break
            current = nodes[current].get("parent_uid")
        if not dominated:
            ordered.append(uid)
            seen.add(uid)
    return ordered


def _independent_children(
    nodes: Mapping[str, Mapping[str, Any]], branch_uid: str
) -> list[str]:
    """Children that themselves have descendants (independently understandable subtrees)."""
    if branch_uid not in nodes:
        return []
    return [
        str(child)
        for child in (nodes[branch_uid].get("children") or [])
        if child in nodes and bool(nodes[child].get("children"))
    ]


def _subtree_size(nodes: Mapping[str, Mapping[str, Any]], branch_uid: str) -> int:
    return len(subtree_uids(nodes, branch_uid, include_self=True))


def _should_split_for_best_fit(
    nodes: Mapping[str, Mapping[str, Any]],
    branch_uid: str,
    node_limit: int,
) -> bool:
    if branch_uid not in nodes:
        return False
    unit_size = _subtree_size(nodes, branch_uid)
    if unit_size <= node_limit:
        return False
    independent = _independent_children(nodes, branch_uid)
    if not independent:
        return False
    child_sizes = [_subtree_size(nodes, child) for child in independent]
    if any(size > node_limit for size in child_sizes):
        return True
    parent_dist = abs(unit_size - node_limit)
    child_best_dist = min(abs(size - node_limit) for size in child_sizes)
    return child_best_dist < parent_dist


def _marks_in_proper_descendants(
    nodes: Mapping[str, Mapping[str, Any]],
    branch_uid: str,
    permanent_marks: set[str],
) -> bool:
    if not permanent_marks or branch_uid not in nodes:
        return False
    for uid in subtree_uids(nodes, branch_uid, include_self=False):
        if uid in permanent_marks:
            return True
    return False


def _resolve_reason(
    *,
    base: str,
    folded: bool,
    over: bool,
) -> str:
    if base == "temporary_mark":
        return "temporary_mark_over_limit" if over else "temporary_mark"
    if base == "permanent_mark":
        if folded:
            return "permanent_mark_folded_over_limit" if over else "permanent_mark_folded"
        return "permanent_mark_over_limit" if over else "permanent_mark"
    if folded:
        return "folded_ancestors_over_limit" if over else "folded_ancestors"
    return "over_limit_kept" if over else "within_limit"


def split_branch_units(
    *,
    palace_id: int,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    node_limit: int,
    permanent_mark_uids: Sequence[str] | set[str] | None = None,
    temporary_root_uids: Sequence[str] | None = None,
) -> list[BranchUnit]:
    """Split from first-level branches into complete subtrees closest to node_limit.

    Coverage invariant: every non-root node appears in exactly one unit's
    ``ratable_node_uids``. When best-fit drills past a parent, that parent is
    **folded into the first descendant unit** (not emitted as a size-1 residual
    card). Sibling branches after the first do not re-include the parent.

    Optional marks:
    - ``temporary_root_uids``: outermost roots each emit one full-subtree unit
      first (selection_reason ``temporary_mark``); those uids are claimed.
    - ``permanent_mark_uids``: force split so mark nodes become unit roots
      (selection_reason ``permanent_mark`` / folded variants). Only freestyle.

    Context path is ancestors above the highest folded / unit root node; those
    ancestors are display-only. The palace root itself is never ratable.
    """
    if not root_uid or root_uid not in nodes:
        return []
    limit = max(1, int(node_limit))
    permanent_marks = {
        str(uid)
        for uid in (permanent_mark_uids or [])
        if str(uid) in nodes and str(uid) != str(root_uid)
    }
    claimed: set[str] = set()
    units: list[BranchUnit] = []

    def append_unit(
        branch_uid: str,
        ratable: Sequence[str],
        *,
        folded_parents: tuple[str, ...] = (),
        base_reason: str,
    ) -> None:
        filtered = tuple(uid for uid in ratable if uid not in claimed and uid in nodes)
        if not filtered:
            return
        node_count = len(filtered)
        over = max(0, node_count - limit)
        context_anchor = folded_parents[0] if folded_parents else branch_uid
        reason = _resolve_reason(
            base=base_reason,
            folded=bool(folded_parents),
            over=over > 0,
        )
        units.append(
            BranchUnit(
                palace_id=palace_id,
                branch_uid=branch_uid,
                context_path=tuple(ancestor_path(nodes, context_anchor)),
                ratable_node_uids=filtered,
                node_count=node_count,
                over_limit_delta=over,
                selection_reason=reason,
            )
        )
        claimed.update(filtered)

    for temp_root in filter_outermost_roots(nodes, list(temporary_root_uids or [])):
        if temp_root == str(root_uid) or temp_root in claimed:
            continue
        subtree = tuple(subtree_uids(nodes, temp_root, include_self=True))
        if not subtree:
            continue
        append_unit(temp_root, subtree, base_reason="temporary_mark")

    def emit(branch_uid: str, folded_parents: tuple[str, ...] = ()) -> None:
        if not branch_uid or branch_uid not in nodes or not str(branch_uid).strip():
            return
        if branch_uid in claimed:
            return
        subtree_all = subtree_uids(nodes, branch_uid, include_self=True)
        if not subtree_all or all(uid in claimed for uid in subtree_all):
            return

        if _marks_in_proper_descendants(nodes, branch_uid, permanent_marks):
            children = [
                str(child)
                for child in (nodes[branch_uid].get("children") or [])
                if child in nodes and child not in claimed
            ]
            for index, child in enumerate(children):
                if index == 0:
                    emit(child, folded_parents + (branch_uid,))
                else:
                    emit(child, ())
            return

        if _should_split_for_best_fit(nodes, branch_uid, limit):
            children = [
                str(child)
                for child in (nodes[branch_uid].get("children") or [])
                if child in nodes and child not in claimed
            ]
            for index, child in enumerate(children):
                if index == 0:
                    emit(child, folded_parents + (branch_uid,))
                else:
                    emit(child, ())
            return

        available_subtree = tuple(uid for uid in subtree_all if uid not in claimed)
        if not available_subtree:
            return
        folded_live = tuple(uid for uid in folded_parents if uid not in claimed)
        ratable = folded_live + available_subtree
        base = "permanent_mark" if branch_uid in permanent_marks else "within_limit"
        append_unit(
            branch_uid,
            ratable,
            folded_parents=folded_live,
            base_reason=base,
        )

    first_level = [
        str(uid)
        for uid in (nodes[root_uid].get("children") or [])
        if uid in nodes and str(uid) not in claimed
    ]
    for branch_uid in first_level:
        emit(branch_uid)

    # Residual non-root nodes not covered (should be rare with mark/temp claims).
    for uid in list(nodes.keys()):
        if uid == root_uid or uid in claimed:
            continue
        parent = nodes[uid].get("parent_uid")
        if parent == root_uid or parent in claimed or parent not in nodes:
            subtree = tuple(
                x for x in subtree_uids(nodes, uid, include_self=True) if x not in claimed
            )
            if subtree:
                base = "permanent_mark" if uid in permanent_marks else "within_limit"
                append_unit(uid, subtree, base_reason=base)

    return units


def sort_units_by_node_policy(units: Sequence[BranchUnit]) -> list[BranchUnit]:
    """Within a priority phase: within-limit smallest first, then smallest over-limit delta."""
    within = [unit for unit in units if unit.over_limit_delta == 0]
    over = [unit for unit in units if unit.over_limit_delta > 0]
    within_sorted = sorted(
        within,
        key=lambda unit: (unit.node_count, unit.palace_id, unit.branch_uid),
    )
    over_sorted = sorted(
        over,
        key=lambda unit: (unit.over_limit_delta, unit.node_count, unit.palace_id, unit.branch_uid),
    )
    return within_sorted + over_sorted


def order_units_within_palace(
    units: Sequence[BranchUnit],
    *,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    shuffle: bool,
    seed: int,
) -> list[BranchUnit]:
    """Palace-internal order: DFS tree order by default, optional deterministic shuffle."""
    if not units:
        return []
    if not shuffle:
        if not root_uid or root_uid not in nodes:
            return sort_units_by_node_policy(units)
        order_index = {
            uid: index
            for index, uid in enumerate(_dfs_order(nodes, root_uid))
        }
        return sorted(
            units,
            key=lambda unit: (
                order_index.get(unit.branch_uid, 10**9),
                unit.palace_id,
                unit.branch_uid,
            ),
        )
    return sorted(
        units,
        key=lambda unit: (
            _stable_hash(seed, unit.palace_id, unit.branch_uid),
            unit.branch_uid,
        ),
    )


def _dfs_order(nodes: Mapping[str, Mapping[str, Any]], root_uid: str) -> list[str]:
    order: list[str] = []
    stack = list(reversed(list(nodes[root_uid].get("children") or [])))
    while stack:
        uid = stack.pop()
        if uid not in nodes:
            continue
        order.append(str(uid))
        children = list(nodes[uid].get("children") or [])
        stack.extend(reversed(children))
    return order


def _stable_hash(seed: int, palace_id: int, branch_uid: str) -> int:
    value = (seed * 1_000_003) ^ (palace_id * 97)
    for char in branch_uid:
        value = (value ^ ord(char)) * 16_777_619
        value &= 0xFFFFFFFF
    return value


__all__ = [
    "BranchUnit",
    "ancestor_path",
    "derive_permanent_mark_levels",
    "filter_outermost_roots",
    "order_units_within_palace",
    "sort_units_by_node_policy",
    "split_branch_units",
    "subtree_uids",
]
