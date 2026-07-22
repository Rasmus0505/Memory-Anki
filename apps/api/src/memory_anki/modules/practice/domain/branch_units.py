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
    """Whether to recurse into children for a closer fit to ``node_limit``.

    Rules:
    - Never truncate siblings: units are always complete single-rooted subtrees.
    - Wide flat branches (only leaf children) stay as one over-limit unit.
    - If any child subtree is still over limit, must drill down.
    - If all child subtrees fit, split only when a child is closer to the limit
      than keeping the parent whole (slightly over-limit parents are preferred
      over many tiny children).
    """
    if branch_uid not in nodes:
        return False
    unit_size = _subtree_size(nodes, branch_uid)
    if unit_size <= node_limit:
        return False
    independent = _independent_children(nodes, branch_uid)
    if not independent:
        # Leaf-only children: keep complete parent (no partial sibling display).
        return False
    child_sizes = [_subtree_size(nodes, child) for child in independent]
    if any(size > node_limit for size in child_sizes):
        return True
    parent_dist = abs(unit_size - node_limit)
    child_best_dist = min(abs(size - node_limit) for size in child_sizes)
    return child_best_dist < parent_dist


def split_branch_units(
    *,
    palace_id: int,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    node_limit: int,
) -> list[BranchUnit]:
    """Split from first-level branches into complete subtrees closest to node_limit.

    Coverage invariant: every non-root node appears in exactly one unit's
    ``ratable_node_uids``. When best-fit drills past a parent, that parent is
    **folded into the first descendant unit** (not emitted as a size-1 residual
    card). Sibling branches after the first do not re-include the parent.

    Context path is ancestors above the highest folded / unit root node; those
    ancestors are display-only. The palace root itself is never ratable.
    """
    if not root_uid or root_uid not in nodes:
        return []
    limit = max(1, int(node_limit))
    first_level = [uid for uid in (nodes[root_uid].get("children") or []) if uid in nodes]
    units: list[BranchUnit] = []

    def emit(branch_uid: str, folded_parents: tuple[str, ...] = ()) -> None:
        if not branch_uid or branch_uid not in nodes:
            return
        # Skip nodes without a stable uid placeholder only when empty string.
        if not str(branch_uid).strip():
            return
        subtree = tuple(subtree_uids(nodes, branch_uid, include_self=True))
        if not subtree:
            return
        if _should_split_for_best_fit(nodes, branch_uid, limit):
            # Drill children; claim this parent on the first child lineage only.
            children = [str(child) for child in (nodes[branch_uid].get("children") or [])]
            for index, child in enumerate(children):
                if index == 0:
                    emit(child, folded_parents + (branch_uid,))
                else:
                    emit(child, ())
            return
        ratable = folded_parents + subtree
        node_count = len(ratable)
        over = max(0, node_count - limit)
        # Context starts above the highest folded parent (or the unit root).
        context_anchor = folded_parents[0] if folded_parents else branch_uid
        reason = "over_limit_kept" if over else "within_limit"
        if folded_parents:
            reason = "folded_ancestors" if not over else "folded_ancestors_over_limit"
        units.append(
            BranchUnit(
                palace_id=palace_id,
                branch_uid=branch_uid,
                context_path=tuple(ancestor_path(nodes, context_anchor)),
                ratable_node_uids=ratable,
                node_count=node_count,
                over_limit_delta=over,
                selection_reason=reason,
            )
        )

    for branch_uid in first_level:
        emit(str(branch_uid))
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
    # Deterministic shuffle keyed by seed + palace + branch.
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
    # FNV-1a style mix for deterministic, seedable ordering without RNG state.
    value = (seed * 1_000_003) ^ (palace_id * 97)
    for char in branch_uid:
        value = (value ^ ord(char)) * 16_777_619
        value &= 0xFFFFFFFF
    return value


__all__ = [
    "BranchUnit",
    "ancestor_path",
    "order_units_within_palace",
    "sort_units_by_node_policy",
    "split_branch_units",
    "subtree_uids",
]
