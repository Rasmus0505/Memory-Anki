"""Pure branch-unit splitting and ordering for freestyle mind-map cards.

Product semantics — mark points are freestyle split anchors
============================================================
Temporary and permanent marks use **the same topology**; only lifecycle differs.

1. **Water-pour model**: pour from the root downward. Water flows through
   unmarked nodes without cutting. Hitting a mark **stops** the stream and
   starts a unit. From that mark down until the next deeper mark, everything
   stays **one unit** (including unmarked sibling branches under the mark).
2. Nested marks L1/L2/L3: level = 1 + count of marked ancestors
   (see ``derive_permanent_mark_levels``). Deeper marks carve their subtrees
   out of the outer mark's unit.
3. Unmarked ancestors above a mark fold into that mark's unit (first claim).
   ``node_limit`` best-fit applies only in fully unmarked residual regions.
4. Permanent: ``permanentSplitMark`` on the editor doc; never cleared by rating.
5. Temporary: ``freestyle_temporary_marks``; cleared after Good/Easy settlement;
   must persist until then.
6. Only difference is **time** (lifecycle), not split geometry.

Examples:
- L1 hub + four unmarked children + one L2 child → **2 units** (L1+four together;
  L2 subtree alone).
- L1 only (no deeper marks) → 1 unit for the whole branch under L1.
- L1 + unmarked mid + 3 L2 children → L1 residual unit {L1,mid} + 3 L2 units.
"""

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
    """Keep roots that are not descendants of another root in the same set.

    Retained as a pure helper for callers that still need outermost-only
    selection. Freestyle split / temporary mark persistence no longer filters
    nested marks away — nested L2/L3 marks are first-class split anchors.
    """
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
    mark_anchors: set[str],
) -> bool:
    """True when any unified split anchor sits strictly under ``branch_uid``."""
    if not mark_anchors or branch_uid not in nodes:
        return False
    for uid in subtree_uids(nodes, branch_uid, include_self=False):
        if uid in mark_anchors:
            return True
    return False


def _is_descendant(
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


def _node_depth(
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


def _mark_region_uids(
    nodes: Mapping[str, Mapping[str, Any]],
    mark_uid: str,
    mark_anchors: set[str],
) -> list[str]:
    """Nodes owned by mark ``mark_uid`` under the water-pour model.

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
        if not _is_descendant(nodes, other, mark_uid):
            continue
        exclude.update(subtree_uids(nodes, other, include_self=True))
    return [uid for uid in full if uid not in exclude]


def _resolve_reason(
    *,
    base: str,
    folded: bool,
    over: bool,
) -> str:
    if base == "temporary_mark":
        if folded:
            return "temporary_mark_folded_over_limit" if over else "temporary_mark_folded"
        return "temporary_mark_over_limit" if over else "temporary_mark"
    if base == "permanent_mark":
        if folded:
            return "permanent_mark_folded_over_limit" if over else "permanent_mark_folded"
        return "permanent_mark_over_limit" if over else "permanent_mark"
    if folded:
        return "folded_ancestors_over_limit" if over else "folded_ancestors"
    return "over_limit_kept" if over else "within_limit"


def _unit_base_reason(
    branch_uid: str,
    *,
    temporary_marks: set[str],
    permanent_marks: set[str],
) -> str:
    """Temp wins when a unit root is in both temporary and permanent sets."""
    if branch_uid in temporary_marks:
        return "temporary_mark"
    if branch_uid in permanent_marks:
        return "permanent_mark"
    return "within_limit"


def split_branch_units(
    *,
    palace_id: int,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    node_limit: int,
    permanent_mark_uids: Sequence[str] | set[str] | None = None,
    temporary_root_uids: Sequence[str] | None = None,
) -> list[BranchUnit]:
    """Split freestyle units: mark water-pour first, then unmarked best-fit.

    **Mark points = freestyle split anchors** (temp and permanent share topology).

    Water-pour model
    ----------------
    Imagine pouring water from the palace root downward. Water flows through
    unmarked nodes without cutting. Hitting a mark anchor **stops** that stream
    and starts a unit at the mark. The unit owns the mark plus every descendant
    until the next deeper mark (deeper mark subtrees are separate units).

    Example: L1 hub with four unmarked children + one L2 child → **2 units**
    (L1 + four siblings together; L2 + its subtree alone) — not five.

    ``node_limit`` best-fit applies only in **fully unmarked** residual regions
    after all mark regions are claimed.

    Coverage: every non-root node appears in exactly one unit. Unclaimed
    ancestors on the path to a mark fold into that mark unit (first claim wins).
    """
    if not root_uid or root_uid not in nodes:
        return []
    limit = max(1, int(node_limit))
    permanent_marks = {
        str(uid)
        for uid in (permanent_mark_uids or [])
        if str(uid) in nodes and str(uid) != str(root_uid)
    }
    temporary_marks = {
        str(uid)
        for uid in (temporary_root_uids or [])
        if str(uid) in nodes and str(uid) != str(root_uid)
    }
    split_anchors = permanent_marks | temporary_marks
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

    def path_ancestors(uid: str) -> list[str]:
        """Rootward → leafward ancestors excluding palace root and ``uid``."""
        path: list[str] = []
        current = nodes.get(uid, {}).get("parent_uid")
        while current and current in nodes:
            path.append(str(current))
            if current == root_uid:
                break
            current = nodes[current].get("parent_uid")
        path.reverse()
        # drop palace root from fold list
        return [p for p in path if p != root_uid]

    # --- Phase 1: mark regions (shallow marks first so outer residual claims first)
    marks_ordered = sorted(
        split_anchors,
        key=lambda uid: (_node_depth(nodes, uid, root_uid=root_uid), uid),
    )
    for mark_uid in marks_ordered:
        region = [
            uid
            for uid in _mark_region_uids(nodes, mark_uid, split_anchors)
            if uid not in claimed and uid in nodes
        ]
        if not region:
            continue
        folded = tuple(
            uid for uid in path_ancestors(mark_uid) if uid not in claimed and uid in nodes
        )
        # Prefer tree order inside the region (DFS from mark)
        region_set = set(region)
        ordered_region = [
            uid for uid in subtree_uids(nodes, mark_uid, include_self=True) if uid in region_set
        ]
        # Any region nodes missed by DFS (should not happen) append at end
        ordered_region.extend(uid for uid in region if uid not in set(ordered_region))
        base = _unit_base_reason(
            mark_uid,
            temporary_marks=temporary_marks,
            permanent_marks=permanent_marks,
        )
        append_unit(
            mark_uid,
            folded + tuple(ordered_region),
            folded_parents=folded,
            base_reason=base,
        )

    # --- Phase 2: unmarked residual (no mark anchors in play) via best-fit / whole
    def emit_unmarked(branch_uid: str, folded_parents: tuple[str, ...] = ()) -> None:
        if not branch_uid or branch_uid not in nodes or not str(branch_uid).strip():
            return
        if branch_uid in claimed:
            return
        subtree_all = [
            uid
            for uid in subtree_uids(nodes, branch_uid, include_self=True)
            if uid not in claimed and uid in nodes
        ]
        if not subtree_all:
            return

        # Should not meet marks here (already claimed); still guard.
        live_marks = {m for m in split_anchors if m in subtree_all}
        if live_marks:
            # Residual pockets between claimed mark regions — take contiguous
            # unclaimed children without re-entering claimed mark subtrees.
            children = [
                str(child)
                for child in (nodes[branch_uid].get("children") or [])
                if child in nodes and child not in claimed
            ]
            for index, child in enumerate(children):
                if index == 0:
                    emit_unmarked(child, folded_parents + (branch_uid,))
                else:
                    emit_unmarked(child, ())
            # branch_uid itself if still free and has no unclaimed children handled
            if branch_uid not in claimed and branch_uid != root_uid:
                # only emit self if nothing below left unclaimed under us
                if not any(
                    c not in claimed
                    for c in (nodes[branch_uid].get("children") or [])
                    if c in nodes
                ):
                    folded_live = tuple(u for u in folded_parents if u not in claimed)
                    append_unit(
                        branch_uid,
                        folded_live + (branch_uid,),
                        folded_parents=folded_live,
                        base_reason="within_limit",
                    )
            return

        # Best-fit only in fully unmarked residual.
        if _should_split_for_best_fit(nodes, branch_uid, limit):
            # best-fit uses full tree sizes; only walk unclaimed children
            children = [
                str(child)
                for child in (nodes[branch_uid].get("children") or [])
                if child in nodes and child not in claimed
            ]
            if children:
                for index, child in enumerate(children):
                    if index == 0:
                        emit_unmarked(child, folded_parents + (branch_uid,))
                    else:
                        emit_unmarked(child, ())
                return

        folded_live = tuple(uid for uid in folded_parents if uid not in claimed)
        ratable = folded_live + tuple(subtree_all)
        append_unit(
            branch_uid,
            ratable,
            folded_parents=folded_live,
            base_reason="within_limit",
        )

    first_level = [
        str(uid)
        for uid in (nodes[root_uid].get("children") or [])
        if uid in nodes and str(uid) not in claimed
    ]
    for branch_uid in first_level:
        emit_unmarked(branch_uid)

    # Residual non-root nodes not covered.
    for uid in list(nodes.keys()):
        if uid == root_uid or uid in claimed:
            continue
        parent = nodes[uid].get("parent_uid")
        if parent == root_uid or parent in claimed or parent not in nodes:
            subtree = tuple(
                x for x in subtree_uids(nodes, uid, include_self=True) if x not in claimed
            )
            if subtree:
                base = _unit_base_reason(
                    uid,
                    temporary_marks=temporary_marks,
                    permanent_marks=permanent_marks,
                )
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
