"""Pure-function tests for freestyle branch unit splitting and ordering."""

from __future__ import annotations

from memory_anki.modules.practice.domain.branch_units import (
    order_units_within_palace,
    sort_units_by_node_policy,
    split_branch_units,
)
from memory_anki.modules.practice.domain.feed_config import sanitize_feed_config
from memory_anki.modules.practice.domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
    interleave_by_weights,
    order_palace_batches,
    sort_quiz_candidates,
)


def _node(uid: str, text: str, children: list | None = None, parent: str | None = None):
    return {
        "uid": uid,
        "text": text,
        "parent_uid": parent,
        "children": [child["uid"] if isinstance(child, dict) else child for child in (children or [])],
    }


def _tree_flat() -> tuple[str, dict]:
    """Root with three first-level branches A/B/C, each small."""
    nodes = {
        "root": _node("root", "Palace"),
        "a": _node("a", "A", parent="root"),
        "a1": _node("a1", "A1", parent="a"),
        "b": _node("b", "B", parent="root"),
        "b1": _node("b1", "B1", parent="b"),
        "c": _node("c", "C", parent="root"),
    }
    nodes["root"]["children"] = ["a", "b", "c"]
    nodes["a"]["children"] = ["a1"]
    nodes["b"]["children"] = ["b1"]
    nodes["c"]["children"] = []
    return "root", nodes


def _tree_deep_over_limit() -> tuple[str, dict]:
    """Root -> branch with nested children that should recurse-split."""
    nodes = {
        "root": _node("root", "Palace"),
        "branch": _node("branch", "Branch", parent="root"),
    }
    nodes["root"]["children"] = ["branch"]
    # branch + 5 children = 6 nodes; with limit 3 and children present, split to children.
    children = []
    for i in range(5):
        uid = f"n{i}"
        nodes[uid] = _node(uid, f"N{i}", parent="branch")
        children.append(uid)
    nodes["branch"]["children"] = children
    return "root", nodes


def _tree_wide_unsplitable() -> tuple[str, dict]:
    """Wide flat branch: many leaf children, still one unit if we only split when children form subtrees
    — actually with children it WILL split. Spec: 无法继续拆分的宽平分支保留为超限单元.

    A wide branch where children are leaves: after split each leaf is a unit of size 1.
    Over-limit kept unit is when branch has NO children but somehow over limit (impossible)
    OR when children exist but splitting doesn't reduce because... wait.

    Actually: if we have branch with 20 leaf children and limit 12:
    - unit size = 21 (branch + 20 leaves)
    - can_split = True because children exist
    - recurse emit children → 20 units of size 1

    For over-limit kept: a branch that has NO children but is somehow large? Impossible with include_self.
    OR: we only split when child subtrees exist AND unit > limit. What about a node with many
    grandchildren under ONE child? Then we recurse into that one child.

    Spec also says: 无法继续拆分的宽平分支保留为超限单元
    Interpretation: when a branch has many children that are leaves, splitting creates leaf units.
    When a SINGLE node has text-only without children and count exceeds limit - can't happen for one node.
    
    Alternative interpretation: when AFTER considering split, if children are empty (leaf cluster
    represented as one node with no structural children), keep over-limit.

    Or: wide branch means many children but we choose NOT to split if children are not
    "independently understandable subtrees" - i.e. only split when children themselves have children?

    Looking at my _can_split: any children allow split. Spec: "存在可独立理解的子树时递归拆分"
    Independent subtree ≈ child with its own structure. Leaves might not be independent subtrees.

    Update _can_split to require at least one child that has children (true subtree)?
    Or child with size > 1?

    I'll refine: can_split if over limit AND any child has grandchildren OR child subtree size >= 2
    (child + descendants). A pure leaf child has size 1 - splitting a star topology of leaves
    would create many tiny units which might be intended... Spec says keep over-limit wide flat.

    So: only recurse when at least one child has its own children (depth).
    """
    nodes = {
        "root": _node("root", "Palace"),
        "wide": _node("wide", "Wide", parent="root"),
    }
    nodes["root"]["children"] = ["wide"]
    leaves = []
    for i in range(15):
        uid = f"leaf{i}"
        nodes[uid] = _node(uid, f"L{i}", parent="wide")
        leaves.append(uid)
    nodes["wide"]["children"] = leaves
    return "root", nodes


def test_split_first_level_branches():
    root, nodes = _tree_flat()
    units = split_branch_units(palace_id=1, nodes=nodes, root_uid=root, node_limit=12)
    assert [u.branch_uid for u in units] == ["a", "b", "c"]
    assert units[0].node_count == 2
    assert units[0].context_path[0]["uid"] == "root"
    assert units[0].over_limit_delta == 0


def test_recursive_split_when_over_limit_with_subtrees():
    root, nodes = _tree_deep_over_limit()
    # Give each n* a grandchild so they are independent subtrees after we refine can_split.
    for i in range(5):
        g = f"g{i}"
        nodes[g] = _node(g, f"G{i}", parent=f"n{i}")
        nodes[f"n{i}"]["children"] = [g]
    units = split_branch_units(palace_id=2, nodes=nodes, root_uid=root, node_limit=3)
    # branch has 1+5*2=11 nodes > 3 → fold branch into first child unit; no size-1 residual card
    assert all(u.branch_uid.startswith("n") for u in units)
    assert len(units) == 5
    assert "branch" in units[0].ratable_node_uids
    assert units[0].node_count == 3  # branch + n0 + g0
    assert all(u.node_count == 2 for u in units[1:])
    assert all(u.selection_reason != "split_residual" for u in units)


def test_wide_flat_over_limit_kept():
    root, nodes = _tree_wide_unsplitable()
    units = split_branch_units(palace_id=3, nodes=nodes, root_uid=root, node_limit=5)
    # 16 nodes, children are leaves only → keep as one over-limit unit
    assert len(units) == 1
    assert units[0].branch_uid == "wide"
    assert units[0].over_limit_delta == 11
    assert units[0].selection_reason == "over_limit_kept"
    # Completeness: never truncate sibling leaves to fit limit.
    assert units[0].node_count == 16
    assert "root" not in units[0].ratable_node_uids


def test_best_fit_keeps_parent_when_closer_than_children():
    """Parent 16 vs three child subtrees of 5 each, limit 15 → keep parent (closer)."""
    nodes = {
        "root": _node("root", "Palace"),
        "parent": _node("parent", "Parent", parent="root"),
    }
    nodes["root"]["children"] = ["parent"]
    child_uids = []
    for i in range(3):
        uid = f"c{i}"
        nodes[uid] = _node(uid, f"C{i}", parent="parent")
        # size 5 = child + 4 leaves (child has children → independent)
        leaves = []
        for j in range(4):
            leaf = f"c{i}l{j}"
            nodes[leaf] = _node(leaf, f"L{i}{j}", parent=uid)
            leaves.append(leaf)
        nodes[uid]["children"] = leaves
        child_uids.append(uid)
    nodes["parent"]["children"] = child_uids
    # parent + 3*5 = 16
    units = split_branch_units(palace_id=4, nodes=nodes, root_uid="root", node_limit=15)
    assert len(units) == 1
    assert units[0].branch_uid == "parent"
    assert units[0].node_count == 16
    assert units[0].over_limit_delta == 1
    assert units[0].context_path[0]["uid"] == "root"
    assert "root" not in units[0].ratable_node_uids


def test_best_fit_splits_when_children_closer_to_limit():
    """Parent 40 vs three size-12 child subtrees + 3 leaves, limit 12 → split."""
    nodes = {
        "root": _node("root", "Palace"),
        "parent": _node("parent", "Parent", parent="root"),
    }
    nodes["root"]["children"] = ["parent"]
    child_uids = []
    for i in range(3):
        uid = f"s{i}"
        nodes[uid] = _node(uid, f"S{i}", parent="parent")
        leaves = []
        # size 12 = self + 11 leaves
        for j in range(11):
            leaf = f"s{i}l{j}"
            nodes[leaf] = _node(leaf, f"L{i}{j}", parent=uid)
            leaves.append(leaf)
        nodes[uid]["children"] = leaves
        child_uids.append(uid)
    for j in range(3):
        extra = f"pextra{j}"
        nodes[extra] = _node(extra, f"E{j}", parent="parent")
        child_uids.append(extra)
    nodes["parent"]["children"] = child_uids
    # size = 1 + 3*12 + 3 = 40
    units = split_branch_units(palace_id=5, nodes=nodes, root_uid="root", node_limit=12)
    assert {u.branch_uid for u in units} == {
        "s0",
        "s1",
        "s2",
        "pextra0",
        "pextra1",
        "pextra2",
    }
    # Parent is folded into the first child unit only — never a lonely residual card.
    assert all(u.branch_uid != "parent" for u in units)
    s0 = next(u for u in units if u.branch_uid == "s0")
    assert "parent" in s0.ratable_node_uids
    assert s0.node_count == 13
    assert all(
        "parent" not in u.ratable_node_uids for u in units if u.branch_uid != "s0"
    )
    assert all(u.node_count == 12 for u in units if u.branch_uid in {"s1", "s2"})


def _assert_full_non_root_coverage(nodes: dict, root_uid: str, units: list) -> None:
    """Every non-root node appears in exactly one unit ratable set."""
    covered: list[str] = []
    for unit in units:
        covered.extend(unit.ratable_node_uids)
    non_root = {uid for uid in nodes if uid != root_uid}
    assert set(covered) == non_root
    assert len(covered) == len(non_root)


def test_folded_ancestors_cover_intermediate_parents_on_deep_tree():
    """User scenario: P → 3×(L1 → L2 → many leaves); no size-1 residual cards."""
    nodes = {
        "root": _node("root", "Palace"),
        "P": _node("P", "Parent", parent="root"),
    }
    nodes["root"]["children"] = ["P"]
    l1_uids = []
    for name in ("A", "B", "C"):
        l1 = f"L1{name}"
        l2 = f"L2{name}"
        nodes[l1] = _node(l1, f"L1-{name}", parent="P")
        nodes[l2] = _node(l2, f"L2-{name}", parent=l1)
        leaves = []
        for j in range(14):
            leaf = f"{l2}l{j}"
            nodes[leaf] = _node(leaf, f"{name}-leaf{j}", parent=l2)
            leaves.append(leaf)
        nodes[l2]["children"] = leaves
        nodes[l1]["children"] = [l2]
        l1_uids.append(l1)
    nodes["P"]["children"] = l1_uids

    units = split_branch_units(palace_id=1, nodes=nodes, root_uid="root", node_limit=12)
    by_uid = {u.branch_uid: u for u in units}

    # Only three real branch units (L2 roots); no lonely P / L1 cards.
    assert set(by_uid) == {"L2A", "L2B", "L2C"}
    assert all(u.node_count > 1 for u in units)
    assert all(u.selection_reason != "split_residual" for u in units)

    # P folds into first lineage only; each L1 folds into its L2 unit.
    assert "P" in by_uid["L2A"].ratable_node_uids
    assert "L1A" in by_uid["L2A"].ratable_node_uids
    assert "P" not in by_uid["L2B"].ratable_node_uids
    assert "L1B" in by_uid["L2B"].ratable_node_uids
    assert "L1C" in by_uid["L2C"].ratable_node_uids
    # Folded parents are ratable, not context-only.
    assert "L1A" not in {c["uid"] for c in by_uid["L2A"].context_path}
    assert by_uid["L2A"].context_path[0]["uid"] == "root"

    _assert_full_non_root_coverage(nodes, "root", units)


def test_no_size_one_residual_units_from_split():
    """Regression: split must not flood the queue with 1-node residual cards."""
    root, nodes = _tree_deep_over_limit()
    for i in range(5):
        g = f"g{i}"
        nodes[g] = _node(g, f"G{i}", parent=f"n{i}")
        nodes[f"n{i}"]["children"] = [g]
    units = split_branch_units(palace_id=2, nodes=nodes, root_uid=root, node_limit=3)
    size_one = [u for u in units if u.node_count == 1]
    assert size_one == []


def test_split_units_partition_all_non_root_nodes():
    root, nodes = _tree_flat()
    units = split_branch_units(palace_id=1, nodes=nodes, root_uid=root, node_limit=12)
    _assert_full_non_root_coverage(nodes, root, units)

    root2, nodes2 = _tree_deep_over_limit()
    for i in range(5):
        g = f"g{i}"
        nodes2[g] = _node(g, f"G{i}", parent=f"n{i}")
        nodes2[f"n{i}"]["children"] = [g]
    units2 = split_branch_units(palace_id=2, nodes=nodes2, root_uid=root2, node_limit=3)
    _assert_full_non_root_coverage(nodes2, root2, units2)


def test_sort_within_limit_then_over_limit_delta():
    root, nodes = _tree_flat()
    units = split_branch_units(palace_id=1, nodes=nodes, root_uid=root, node_limit=1)
    # a=2, b=2, c=1 with limit 1 → a,b over by 1, c within
    ordered = sort_units_by_node_policy(units)
    assert ordered[0].branch_uid == "c"
    assert ordered[0].over_limit_delta == 0
    assert ordered[1].over_limit_delta >= ordered[0].over_limit_delta


def test_tree_order_and_deterministic_shuffle():
    root, nodes = _tree_flat()
    units = split_branch_units(palace_id=1, nodes=nodes, root_uid=root, node_limit=12)
    tree_order = order_units_within_palace(
        units, nodes=nodes, root_uid=root, shuffle=False, seed=1
    )
    assert [u.branch_uid for u in tree_order] == ["a", "b", "c"]
    shuffled_a = order_units_within_palace(
        units, nodes=nodes, root_uid=root, shuffle=True, seed=42
    )
    shuffled_b = order_units_within_palace(
        units, nodes=nodes, root_uid=root, shuffle=True, seed=42
    )
    assert [u.branch_uid for u in shuffled_a] == [u.branch_uid for u in shuffled_b]


def test_palace_sequential_vs_interleave():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    u1 = BranchUnit(1, "a", (), ("a",), 1, 0)
    u2 = BranchUnit(1, "b", (), ("b",), 1, 0)
    u3 = BranchUnit(2, "x", (), ("x",), 1, 0)
    sequential = order_palace_batches(
        [1, 2], {1: [u1, u2], 2: [u3]}, palace_order="finish_palace_then_next", seed=1
    )
    assert [u.branch_uid for u in sequential] == ["a", "b", "x"]
    interleave = order_palace_batches(
        [1, 2], {1: [u1, u2], 2: [u3]}, palace_order="interleave_palaces", seed=1
    )
    # Round-robin across seed-ordered palaces; both palaces represented early.
    assert len(interleave) == 3
    assert {u.palace_id for u in interleave[:2]}  # first two may mix


def test_quiz_weak_sort_and_weights():
    quizzes = [
        QuizCandidate(3, 1, (), 0.9, "stable", {"id": 3}),
        QuizCandidate(1, 1, (), 0.2, "weak", {"id": 1}),
        QuizCandidate(2, 1, (), 0.4, "unseen", {"id": 2}),
    ]
    ordered = sort_quiz_candidates(quizzes, weak_priority=True)
    assert [q.question_id for q in ordered] == [1, 2, 3]

    mixed = interleave_by_weights(
        [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}, {"id": "m4"}],
        [{"id": "q1"}, {"id": "q2"}],
        mindmap_weight=2,
        quiz_weight=1,
        seed=1,
    )
    assert len(mixed) == 6
    # First stretch should prefer 2 mindmap then 1 quiz pattern-ish
    mindmap_ids = {c["id"] for c in mixed if c["id"].startswith("m")}
    assert mindmap_ids == {"m1", "m2", "m3", "m4"}


def test_assemble_queue_due_phase_and_seed_stable():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    due_unit = BranchUnit(1, "due", (), ("d1", "d2"), 2, 0)
    fill_unit = BranchUnit(1, "fill", (), ("f1",), 1, 0)
    config = sanitize_feed_config(
        {
            "seed": 9,
            "queue_length": 10,
            "weights": {"mindmap_branch": 2, "quiz_question": 1},
            "content": {"mindmap_branch": True, "quiz_question": True},
        }
    )
    quizzes = [
        QuizCandidate(10, 1, (), 0.1, "weak", {"id": 10, "palace_id": 1}),
        QuizCandidate(11, 1, (), 0.95, "stable", {"id": 11, "palace_id": 1}),
    ]
    a = assemble_queue(
        config=config,
        palace_meta={1: {"title": "P"}},
        units_by_palace={1: [due_unit, fill_unit]},
        due_by_palace={1: {"d1"}},
        mastery_by_palace={1: 0.4},
        recent_practice_rank={1: 0},
        quizzes=quizzes,
        operation_id="op-1",
    )
    b = assemble_queue(
        config=config,
        palace_meta={1: {"title": "P"}},
        units_by_palace={1: [due_unit, fill_unit]},
        due_by_palace={1: {"d1"}},
        mastery_by_palace={1: 0.4},
        recent_practice_rank={1: 0},
        quizzes=quizzes,
        operation_id="op-1",
    )
    assert [c["id"] for c in a.cards] == [c["id"] for c in b.cards]
    assert a.operation_id == "op-1"
    # Due mindmap unit and weak quiz appear in phase1
    assert a.phase_stats["due_unit_count"] == 1
    assert a.phase_stats["priority_quiz_count"] == 1

    # Refresh excludes completed
    completed = {a.cards[0]["id"]} if a.cards else set()
    refreshed = assemble_queue(
        config=config,
        palace_meta={1: {"title": "P"}},
        units_by_palace={1: [due_unit, fill_unit]},
        due_by_palace={1: {"d1"}},
        mastery_by_palace={1: 0.4},
        recent_practice_rank={1: 0},
        quizzes=quizzes,
        completed_ids=completed,
        operation_id="op-2",
    )
    assert all(card["id"] not in completed for card in refreshed.cards)


def test_bound_quiz_follows_its_branch_and_sequential_palaces_stay_grouped():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    first = BranchUnit(1, "a", (), ("a", "a1"), 2, 0)
    second = BranchUnit(2, "b", (), ("b", "b1"), 2, 0)
    config = sanitize_feed_config(
        {
            "palace_order": "finish_palace_then_next",
            "due_policy": "due_only",
            "queue_length": 20,
        }
    )
    result = assemble_queue(
        config=config,
        palace_meta={1: {"title": "P1"}, 2: {"title": "P2"}},
        units_by_palace={1: [first], 2: [second]},
        due_by_palace={1: {"a1"}, 2: {"b1"}},
        mastery_by_palace={1: 0.5, 2: 0.5},
        recent_practice_rank={},
        quizzes=[
            QuizCandidate(21, 1, ("a1",), 0.1, "weak", {"id": 21, "palace_id": 1}),
            QuizCandidate(22, 2, ("b1",), 0.1, "weak", {"id": 22, "palace_id": 2}),
        ],
    )
    assert [card["id"] for card in result.cards] == [
        "mindmap_branch:1:a",
        "quiz_question:21",
        "mindmap_branch:2:b",
        "quiz_question:22",
    ]


def test_all_weighted_is_not_an_alias_of_due_first():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    due = BranchUnit(1, "due", (), ("due",), 1, 0)
    fill = BranchUnit(1, "fill", (), ("fill",), 1, 0)
    common = {
        "palace_meta": {1: {"title": "P"}},
        "units_by_palace": {1: [due, fill]},
        "due_by_palace": {1: {"due"}},
        "mastery_by_palace": {1: 0.5},
        "recent_practice_rank": {},
        "quizzes": [],
    }
    due_first = assemble_queue(
        config=sanitize_feed_config({"due_policy": "due_first_then_expand"}),
        **common,
    )
    weighted = assemble_queue(
        config=sanitize_feed_config({"due_policy": "all_content_due_weighted"}),
        **common,
    )
    assert due_first.phase_stats["phase2_count"] == 1
    assert weighted.phase_stats["phase2_count"] == 0
    assert weighted.phase_stats["phase1_count"] == 2


def test_sanitize_feed_config_bounds():
    config = sanitize_feed_config(
        {
            "node_limit": 100,
            "queue_length": 1,
            "seed": -3,
            "content": {"mindmap_branch": False, "quiz_question": False},
        }
    )
    assert config["node_limit"] == 50
    assert config["queue_length"] == 5
    assert config["seed"] == 1
    # Both disabled → re-enable both
    assert config["content"]["mindmap_branch"] is True
    assert config["content"]["quiz_question"] is True
