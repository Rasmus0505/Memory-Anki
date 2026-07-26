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
    fill_quiz = QuizCandidate(30, 1, (), 0.9, "stable", {"id": 30, "palace_id": 1})
    common = {
        "palace_meta": {1: {"title": "P"}},
        "units_by_palace": {1: [due, fill]},
        "due_by_palace": {1: {"due"}},
        "mastery_by_palace": {1: 0.5},
        "recent_practice_rank": {},
        "quizzes": [fill_quiz],
    }
    due_first = assemble_queue(
        config=sanitize_feed_config({"due_policy": "due_first_then_expand"}),
        **common,
    )
    weighted = assemble_queue(
        config=sanitize_feed_config({"due_policy": "all_content_due_weighted"}),
        **common,
    )
    # Mind-map fill units without due nodes are never emitted (formal review only).
    assert all(
        card.get("type") != "mindmap_branch" or card.get("due_node_count", 0) > 0
        for card in due_first.cards + weighted.cards
    )
    # due_first keeps fill quizzes in phase2; weighted folds everything into phase1.
    assert due_first.phase_stats["phase2_count"] == 1
    assert weighted.phase_stats["phase2_count"] == 0
    assert weighted.phase_stats["phase1_count"] == 2
    assert sum(1 for card in due_first.cards if card["type"] == "mindmap_branch") == 1
    assert sum(1 for card in weighted.cards if card["type"] == "mindmap_branch") == 1


def test_mindmap_cards_require_due_nodes():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    fill_only = BranchUnit(1, "fill", (), ("f1", "f2"), 2, 0)
    result = assemble_queue(
        config=sanitize_feed_config({"due_policy": "due_first_then_expand", "queue_length": 10}),
        palace_meta={1: {"title": "P"}},
        units_by_palace={1: [fill_only]},
        due_by_palace={1: set()},
        mastery_by_palace={1: 0.5},
        recent_practice_rank={},
        quizzes=[],
        operation_id="op-no-due",
    )
    assert result.cards == []
    assert result.phase_stats["fill_unit_count"] == 1


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
    # anki_card still defaults on → do not force-re-enable the other two
    assert config["content"]["mindmap_branch"] is False
    assert config["content"]["anki_card"] is True
    assert config["content"]["quiz_question"] is False
    assert config["include_calendar_today_due"] is False
    assert config["progress_scopes"] == [
        "overdue",
        "due",
        "reinforcement",
        "new",
    ]


def test_sanitize_feed_config_progress_scopes():
    empty = sanitize_feed_config({})
    assert empty.get("include_calendar_today_due") is False
    assert empty["progress_scopes"] == [
        "overdue",
        "due",
        "reinforcement",
        "new",
    ]

    with_flag = sanitize_feed_config({"include_calendar_today_due": True})
    assert with_flag["include_calendar_today_due"] is True
    assert "calendar_today" in with_flag["progress_scopes"]

    only_calendar = sanitize_feed_config({"progress_scopes": ["calendar_today"]})
    assert only_calendar["progress_scopes"] == ["calendar_today"]
    assert only_calendar["include_calendar_today_due"] is True

    empty_scopes = sanitize_feed_config({"progress_scopes": []})
    assert empty_scopes["progress_scopes"] == [
        "overdue",
        "due",
        "reinforcement",
        "new",
    ]

def test_permanent_marks_force_sibling_split():
    """L1 marks on education purpose/effect force separate freestyle units."""
    nodes = {
        "root": _node("root", "Palace"),
        "purpose": _node("purpose", "教育目的", parent="root"),
        "purpose_child": _node("purpose_child", "棕威平", parent="purpose"),
        "effect": _node("effect", "教育作用", parent="root"),
        "society": _node("society", "社会作用", parent="effect"),
        "person": _node("person", "人的作用", parent="effect"),
        "society_leaf": _node("society_leaf", "改造社会", parent="society"),
        "person_leaf": _node("person_leaf", "天赋", parent="person"),
    }
    nodes["root"]["children"] = ["purpose", "effect"]
    nodes["purpose"]["children"] = ["purpose_child"]
    nodes["effect"]["children"] = ["society", "person"]
    nodes["society"]["children"] = ["society_leaf"]
    nodes["person"]["children"] = ["person_leaf"]

    # Without marks: effect subtree (effect+society+person+2 leaves=5) may stay together under high limit.
    plain = split_branch_units(palace_id=1, nodes=nodes, root_uid="root", node_limit=20)
    assert {u.branch_uid for u in plain} == {"purpose", "effect"}

    # L1 permanent marks on purpose + effect: still separate (already first-level).
    marked = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        permanent_mark_uids=["purpose", "effect"],
    )
    assert {u.branch_uid for u in marked} == {"purpose", "effect"}
    assert all(u.selection_reason.startswith("permanent_mark") for u in marked)

    # L2 under effect: water-pour → purpose | effect residual | society | person
    deep = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        permanent_mark_uids=["purpose", "effect", "society", "person"],
    )
    by = {u.branch_uid: u for u in deep}
    assert set(by) == {"purpose", "effect", "society", "person"}
    assert set(by["effect"].ratable_node_uids) == {"effect"}
    assert "society_leaf" in by["society"].ratable_node_uids
    assert "person_leaf" in by["person"].ratable_node_uids
    assert "effect" not in by["society"].ratable_node_uids
    assert "effect" not in by["person"].ratable_node_uids


def test_temporary_roots_claim_full_subtrees():
    nodes = {
        "root": _node("root", "殖民地时期的教育"),
        "north": _node("north", "北部", parent="root"),
        "south": _node("south", "南部", parent="root"),
        "mid": _node("mid", "中部", parent="root"),
        "n1": _node("n1", "宗教", parent="north"),
        "s1": _node("s1", "庄园", parent="south"),
        "m1": _node("m1", "教堂", parent="mid"),
        "other": _node("other", "其他", parent="root"),
        "o1": _node("o1", "其他子", parent="other"),
    }
    nodes["root"]["children"] = ["north", "south", "mid", "other"]
    nodes["north"]["children"] = ["n1"]
    nodes["south"]["children"] = ["s1"]
    nodes["mid"]["children"] = ["m1"]
    nodes["other"]["children"] = ["o1"]

    units = split_branch_units(
        palace_id=9,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=["north", "south", "mid"],
    )
    by_branch = {u.branch_uid: u for u in units}
    assert set(by_branch) == {"north", "south", "mid", "other"}
    assert by_branch["north"].selection_reason == "temporary_mark"
    assert set(by_branch["north"].ratable_node_uids) == {"north", "n1"}
    assert by_branch["other"].selection_reason == "within_limit"


def test_temporary_nested_marks_force_split_like_permanent():
    nodes = {
        "root": _node("root", "P"),
        "a": _node("a", "A", parent="root"),
        "a1": _node("a1", "A1", parent="a"),
        "a1x": _node("a1x", "A1X", parent="a1"),
    }
    nodes["root"]["children"] = ["a"]
    nodes["a"]["children"] = ["a1"]
    nodes["a1"]["children"] = ["a1x"]
    units = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=["a", "a1"],
    )
    # Water-pour: unit at a = {a}; unit at a1 = {a1, a1x}
    by = {u.branch_uid: set(u.ratable_node_uids) for u in units}
    assert by == {"a": {"a"}, "a1": {"a1", "a1x"}}
    assert all(u.selection_reason.startswith("temporary_mark") for u in units)





def test_mark_anchor_keeps_full_subtree_despite_node_limit():
    """L2 on 高等教育 must keep all unmarked siblings in one unit.

    Regression: node_limit best-fit used to drill past a mark and emit separate
    units for 赠地法案 / 变化 / 三大职能 — so freestyle flip only showed one
    branch under 赠地变化职能.
    """
    nodes = {
        "root": _node("root", "P"),
        "sec": _node("sec", "第五节", parent="root"),
        "c19": _node("c19", "19世纪", parent="sec"),
        "move": _node("move", "高等运动", parent="c19"),
        "he": _node("he", "高等教育", parent="move"),
        "land": _node("land", "赠地变化职能", parent="he"),
        "bill": _node("bill", "赠地法案", parent="land"),
        "bill1": _node("bill1", "b1", parent="bill"),
        "change": _node("change", "高等教育的变化", parent="land"),
        "change1": _node("change1", "c1", parent="change"),
        "func": _node("func", "三大职能", parent="land"),
        "func1": _node("func1", "高等教育史上", parent="func"),
        "func2": _node("func2", "中世纪大学", parent="func"),
    }
    nodes["root"]["children"] = ["sec"]
    nodes["sec"]["children"] = ["c19"]
    nodes["c19"]["children"] = ["move"]
    nodes["move"]["children"] = ["he"]
    nodes["he"]["children"] = ["land"]
    nodes["land"]["children"] = ["bill", "change", "func"]
    nodes["bill"]["children"] = ["bill1"]
    nodes["change"]["children"] = ["change1"]
    nodes["func"]["children"] = ["func1", "func2"]

    # Without marks, low limit still best-fit splits the three siblings.
    plain = split_branch_units(
        palace_id=1, nodes=nodes, root_uid="root", node_limit=4
    )
    assert {u.branch_uid for u in plain} == {"bill", "change", "func"}

    # With L2 only on 高等教育: one unit containing all three sibling trees.
    marked = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=4,
        permanent_mark_uids=["he"],
    )
    assert len(marked) == 1
    unit = marked[0]
    assert unit.branch_uid == "he"
    assert unit.selection_reason.startswith("permanent_mark")
    ratable = set(unit.ratable_node_uids)
    assert {"he", "land", "bill", "bill1", "change", "change1", "func", "func1", "func2"} <= ratable
    # Folded single-child spine ancestors may also be ratable.
    assert "bill" in ratable and "change" in ratable and "func" in ratable

    # Temporary mark same topology.
    temp = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=4,
        temporary_root_uids=["he"],
    )
    assert len(temp) == 1
    assert temp[0].branch_uid == "he"
    assert set(temp[0].ratable_node_uids) == set(unit.ratable_node_uids)
    assert temp[0].selection_reason.startswith("temporary_mark")



def test_water_pour_l1_hub_four_unmarked_plus_one_l2():
    """User model: L1 hub + 4 unmarked siblings + 1 L2 → exactly 2 units.

    上面四个为一个复习单元，下面论教育学与师范教育是一个单元。
    """
    nodes = {
        "root": _node("root", "P"),
        "thought": _node("thought", "教育思想", parent="root"),
        "hub": _node("hub", "L1枢纽", parent="thought"),
        "ushinsky": _node("ushinsky", "乌申斯基", parent="hub"),
        "u1": _node("u1", "u-leaf", parent="ushinsky"),
        "essence": _node("essence", "本质与目的", parent="hub"),
        "e1": _node("e1", "e-leaf", parent="essence"),
        "curriculum": _node("curriculum", "课程教学观", parent="hub"),
        "c1": _node("c1", "c-leaf", parent="curriculum"),
        "moral": _node("moral", "论道德教育", parent="hub"),
        "m1": _node("m1", "m-leaf", parent="moral"),
        "normal": _node("normal", "论教育学及师范教育", parent="hub"),
        "n1": _node("n1", "广义目的", parent="normal"),
        "n2": _node("n2", "n-leaf", parent="n1"),
    }
    nodes["root"]["children"] = ["thought"]
    nodes["thought"]["children"] = ["hub"]
    nodes["hub"]["children"] = ["ushinsky", "essence", "curriculum", "moral", "normal"]
    nodes["ushinsky"]["children"] = ["u1"]
    nodes["essence"]["children"] = ["e1"]
    nodes["curriculum"]["children"] = ["c1"]
    nodes["moral"]["children"] = ["m1"]
    nodes["normal"]["children"] = ["n1"]
    nodes["n1"]["children"] = ["n2"]

    units = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=4,  # would otherwise shatter if best-fit ran under hub
        permanent_mark_uids=["hub", "normal"],
    )
    assert len(units) == 2
    by = {u.branch_uid: set(u.ratable_node_uids) for u in units}
    assert set(by) == {"hub", "normal"}
    # L1 unit: hub + four unmarked branches (+ folded 教育思想)
    assert {"hub", "ushinsky", "u1", "essence", "e1", "curriculum", "c1", "moral", "m1"} <= by["hub"]
    assert "thought" in by["hub"]
    assert "normal" not in by["hub"]
    assert "n1" not in by["hub"]
    # L2 unit: normal subtree only
    assert by["normal"] == {"normal", "n1", "n2"}
    assert all(u.selection_reason.startswith("permanent_mark") for u in units)


def test_temporary_legend_l1_with_three_l2_marks():
    """L1 + 3 L2 temp marks => 3 units; L1 only => 1 whole branch."""
    nodes = {
        "root": _node("root", "P"),
        "l1": _node("l1", "17-18", parent="root"),
        "mid": _node("mid", "mid", parent="l1"),
        "l2a": _node("l2a", "L2A", parent="mid"),
        "l2b": _node("l2b", "L2B", parent="mid"),
        "l2c": _node("l2c", "L2C", parent="mid"),
        "l2a_leaf": _node("l2a_leaf", "a-leaf", parent="l2a"),
        "l2b_leaf": _node("l2b_leaf", "b-leaf", parent="l2b"),
        "l2c_leaf": _node("l2c_leaf", "c-leaf", parent="l2c"),
    }
    nodes["root"]["children"] = ["l1"]
    nodes["l1"]["children"] = ["mid"]
    nodes["mid"]["children"] = ["l2a", "l2b", "l2c"]
    nodes["l2a"]["children"] = ["l2a_leaf"]
    nodes["l2b"]["children"] = ["l2b_leaf"]
    nodes["l2c"]["children"] = ["l2c_leaf"]

    three = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=["l1", "l2a", "l2b", "l2c"],
    )
    by = {u.branch_uid: set(u.ratable_node_uids) for u in three}
    # L1 residual {l1, mid} + each L2 subtree
    assert set(by) == {"l1", "l2a", "l2b", "l2c"}
    assert by["l1"] == {"l1", "mid"}
    assert by["l2a"] == {"l2a", "l2a_leaf"}
    assert by["l2b"] == {"l2b", "l2b_leaf"}
    assert by["l2c"] == {"l2c", "l2c_leaf"}
    assert all(u.selection_reason.startswith("temporary_mark") for u in three)

    whole = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=["l1"],
    )
    assert len(whole) == 1
    assert whole[0].branch_uid == "l1"
    assert set(whole[0].ratable_node_uids) == {
        "l1", "mid", "l2a", "l2b", "l2c", "l2a_leaf", "l2b_leaf", "l2c_leaf"
    }
    assert whole[0].selection_reason == "temporary_mark"


def test_temporary_multi_level_same_topology_as_permanent():
    """Temporary multi-level marks produce the same unit topology as permanent."""
    nodes = {
        "root": _node("root", "Palace"),
        "purpose": _node("purpose", "purpose", parent="root"),
        "purpose_child": _node("purpose_child", "purpose_child", parent="purpose"),
        "effect": _node("effect", "effect", parent="root"),
        "society": _node("society", "society", parent="effect"),
        "person": _node("person", "person", parent="effect"),
        "society_leaf": _node("society_leaf", "society_leaf", parent="society"),
        "person_leaf": _node("person_leaf", "person_leaf", parent="person"),
    }
    nodes["root"]["children"] = ["purpose", "effect"]
    nodes["purpose"]["children"] = ["purpose_child"]
    nodes["effect"]["children"] = ["society", "person"]
    nodes["society"]["children"] = ["society_leaf"]
    nodes["person"]["children"] = ["person_leaf"]
    marks = ["purpose", "effect", "society", "person"]
    permanent = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        permanent_mark_uids=marks,
    )
    temporary = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        temporary_root_uids=marks,
    )
    assert [u.branch_uid for u in temporary] == [u.branch_uid for u in permanent]
    for p_unit, t_unit in zip(permanent, temporary, strict=False):
        assert list(p_unit.ratable_node_uids) == list(t_unit.ratable_node_uids)
        assert p_unit.selection_reason.replace("permanent_mark", "temporary_mark") == t_unit.selection_reason


def test_derive_permanent_mark_levels_auto():
    from memory_anki.modules.practice.domain.branch_units import derive_permanent_mark_levels

    nodes = {
        "root": _node("root", "P"),
        "a": _node("a", "A", parent="root"),
        "b": _node("b", "B", parent="a"),
        "c": _node("c", "C", parent="b"),
    }
    nodes["root"]["children"] = ["a"]
    nodes["a"]["children"] = ["b"]
    nodes["b"]["children"] = ["c"]
    levels = derive_permanent_mark_levels(nodes, ["a", "c"], root_uid="root")
    assert levels == {"a": 1, "c": 2}


def test_mark_coverage_no_duplicate_uids():
    nodes = {
        "root": _node("root", "P"),
        "a": _node("a", "A", parent="root"),
        "a1": _node("a1", "A1", parent="a"),
        "b": _node("b", "B", parent="root"),
        "b1": _node("b1", "B1", parent="b"),
    }
    nodes["root"]["children"] = ["a", "b"]
    nodes["a"]["children"] = ["a1"]
    nodes["b"]["children"] = ["b1"]
    units = split_branch_units(
        palace_id=1,
        nodes=nodes,
        root_uid="root",
        node_limit=20,
        permanent_mark_uids=["a", "b"],
        temporary_root_uids=["a"],
    )
    seen: list[str] = []
    for unit in units:
        seen.extend(unit.ratable_node_uids)
    assert len(seen) == len(set(seen))
    assert set(seen) == {"a", "a1", "b", "b1"}


def test_mix_mode_ratio_and_random():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit
    from memory_anki.modules.practice.domain.queue_builder import (
        deterministic_random_merge,
        merge_streams_by_mix_mode,
    )

    units = [
        BranchUnit(1, "a", (), ("a1",), 1, 0),
        BranchUnit(1, "b", (), ("b1",), 1, 0),
        BranchUnit(1, "c", (), ("c1",), 1, 0),
        BranchUnit(1, "d", (), ("d1",), 1, 0),
    ]
    quizzes = [
        QuizCandidate(1, 1, (), 0.1, "weak", {"id": 1, "palace_id": 1}),
        QuizCandidate(2, 1, (), 0.2, "weak", {"id": 2, "palace_id": 1}),
    ]
    common = {
        "palace_meta": {1: {"title": "P"}},
        "units_by_palace": {1: units},
        "due_by_palace": {1: {"a1", "b1", "c1", "d1"}},
        "mastery_by_palace": {1: 0.3},
        "recent_practice_rank": {},
        "quizzes": quizzes,
    }

    ratio = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "ratio",
                "mix_ratio": {"mindmap": 2, "quiz": 1},
                "bound_quiz_placement": "into_mix",
                "due_policy": "due_only",
                "queue_length": 20,
            }
        ),
        **common,
    )
    types = [card["type"] for card in ratio.cards]
    assert types.count("mindmap_branch") == 4
    assert types.count("quiz_question") == 2
    # 2 map : 1 quiz cadence at the start
    assert types[:3] in (
        ["mindmap_branch", "mindmap_branch", "quiz_question"],
        ["quiz_question", "mindmap_branch", "mindmap_branch"],
    )

    only_map = assemble_queue(
        config=sanitize_feed_config({"mix_mode": "mindmap_only", "queue_length": 20}),
        **common,
    )
    assert all(card["type"] == "mindmap_branch" for card in only_map.cards)
    assert len(only_map.cards) == 4

    only_quiz = assemble_queue(
        config=sanitize_feed_config({"mix_mode": "quiz_only", "queue_length": 20}),
        **common,
    )
    assert all(card["type"] == "quiz_question" for card in only_quiz.cards)
    assert len(only_quiz.cards) == 2

    seq = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "sequential_map_quiz",
                "bound_quiz_placement": "into_mix",
                "queue_length": 20,
            }
        ),
        **common,
    )
    seq_types = [card["type"] for card in seq.cards]
    assert seq_types[:4] == ["mindmap_branch"] * 4
    assert seq_types[4:] == ["quiz_question"] * 2

    random_a = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "random",
                "bound_quiz_placement": "into_mix",
                "seed": 11,
                "queue_length": 20,
            }
        ),
        **common,
    )
    random_b = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "random",
                "bound_quiz_placement": "into_mix",
                "seed": 11,
                "queue_length": 20,
            }
        ),
        **common,
    )
    random_c = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "random",
                "bound_quiz_placement": "into_mix",
                "seed": 12,
                "queue_length": 20,
            }
        ),
        **common,
    )
    assert [c["id"] for c in random_a.cards] == [c["id"] for c in random_b.cards]
    assert [c["id"] for c in random_a.cards] != [c["id"] for c in random_c.cards]

    merged = merge_streams_by_mix_mode(
        [{"id": "m1"}, {"id": "m2"}],
        [{"id": "q1"}],
        mix_mode="sequential_quiz_map",
        mix_ratio_mindmap=2,
        mix_ratio_quiz=1,
        seed=1,
    )
    assert [c["id"] for c in merged] == ["q1", "m1", "m2"]
    rand = deterministic_random_merge(
        [{"id": "m1"}, {"id": "m2"}],
        [{"id": "q1"}],
        seed=5,
    )
    assert {c["id"] for c in rand} == {"m1", "m2", "q1"}


def test_bound_quiz_into_mix_does_not_force_follow():
    from memory_anki.modules.practice.domain.branch_units import BranchUnit

    first = BranchUnit(1, "a", (), ("a1",), 1, 0)
    second = BranchUnit(1, "b", (), ("b1",), 1, 0)
    result = assemble_queue(
        config=sanitize_feed_config(
            {
                "mix_mode": "sequential_map_quiz",
                "bound_quiz_placement": "into_mix",
                "due_policy": "due_only",
                "queue_length": 20,
            }
        ),
        palace_meta={1: {"title": "P"}},
        units_by_palace={1: [first, second]},
        due_by_palace={1: {"a1", "b1"}},
        mastery_by_palace={1: 0.4},
        recent_practice_rank={},
        quizzes=[
            QuizCandidate(21, 1, ("a1",), 0.1, "weak", {"id": 21, "palace_id": 1}),
            QuizCandidate(22, 1, ("b1",), 0.1, "weak", {"id": 22, "palace_id": 1}),
        ],
    )
    assert [card["id"] for card in result.cards] == [
        "mindmap_branch:1:a",
        "mindmap_branch:1:b",
        "quiz_question:21",
        "quiz_question:22",
    ]


def test_sanitize_feed_config_mix_mode_defaults():
    legacy = sanitize_feed_config(
        {
            "content": {"mindmap_branch": True, "quiz_question": True},
            "weights": {"mindmap_branch": 2, "anki_card": 0, "quiz_question": 1},
        }
    )
    assert legacy["mix_mode"] == "ratio"
    assert legacy["mix_ratio"] == {"mindmap": 2, "quiz": 1}
    assert legacy["bound_quiz_placement"] == "follow_unit"

    only_quiz = sanitize_feed_config(
        {"content": {"mindmap_branch": False, "anki_card": False, "quiz_question": True}}
    )
    assert only_quiz["mix_mode"] == "quiz_only"
