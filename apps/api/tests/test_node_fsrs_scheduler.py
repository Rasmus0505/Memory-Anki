import json
from datetime import datetime

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState, ReviewRatingOperation
from memory_anki.modules.memory.application.node_memory_service import (
    get_palace_due_rollup,
    get_palace_mastery_trend,
    get_palace_memory_projection,
    rate_nodes,
    undo_rating_operation,
)


def _palace(session):
    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {
                    "data": {"uid": "a", "text": "A"},
                    "children": [{"data": {"uid": "a1", "text": "A1"}, "children": []}],
                },
                {"data": {"uid": "b", "text": "B"}, "children": []},
            ],
        }
    }
    palace = Palace(
        title="FSRS", description="", difficulty=0, review_mode="review",
        editor_doc=json.dumps(document),
    )
    session.add(palace)
    session.commit()
    return palace


def test_subtree_rating_updates_all_non_root_nodes(db_session):
    palace = _palace(db_session)
    result = rate_nodes(
        db_session, palace_id=palace.id, node_uid="a", rating=4,
        study_session_id="s1", operation_id="op1", rating_scope="subtree",
    )
    assert result["affected_node_count"] == 2
    assert {row.node_uid for row in db_session.query(ReviewNodeState).all()} == {"a", "a1"}
    assert db_session.query(ReviewRatingOperation).one().rating == 4


def test_all_fsrs_ratings_persist(db_session):
    """Ratings 1-4 must all persist (legacy DB check only allowed 1/3/5)."""
    from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent

    palace = _palace(db_session)
    for rating in (1, 2, 3, 4):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid="b",
            rating=rating,
            study_session_id="s-ratings",
            operation_id=f"op-rating-{rating}",
            rating_scope="single",
        )
    rows = (
        db_session.query(MindMapRecallEvent)
        .filter_by(palace_id=palace.id, node_uid="b")
        .order_by(MindMapRecallEvent.created_at.asc())
        .all()
    )
    assert [row.rating for row in rows] == [1, 2, 3, 4]


def test_again_and_hard_schedule_immediate_restudy_not_days(db_session):
    """忘记/困难 → immediate reinforcement restudy batch; multi-day only after 记得/轻松."""
    from datetime import UTC, datetime, timedelta

    palace = _palace(db_session)
    # Grow a mature review card first (Good chain).
    for index in range(3):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid="b",
            rating=3,
            study_session_id="s-mature",
            operation_id=f"op-good-{index}",
            rating_scope="single",
        )
        row = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
        # Advance due into the past so the next rating is not learning-step only.
        row.due_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        db_session.commit()

    mature = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
    assert mature.due_at is not None

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=2,
        study_session_id="s-hard",
        operation_id="op-hard",
        rating_scope="single",
    )
    hard = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
    hard_delta = hard.due_at - (hard.last_review_at or hard.due_at)
    assert hard.schedule_source == "reinforcement"
    assert hard.schedule_reason == "reinforcement_r2_batch"
    # Immediately available for the next restudy pass (no multi-day bounce).
    assert hard_delta <= timedelta(minutes=1, seconds=5)
    assert hard_delta < timedelta(days=1)

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=1,
        study_session_id="s-again",
        operation_id="op-again",
        rating_scope="single",
    )
    again = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
    again_delta = again.due_at - (again.last_review_at or again.due_at)
    assert again.schedule_source == "reinforcement"
    assert again.schedule_reason == "reinforcement_r1_batch"
    assert again_delta <= timedelta(minutes=1, seconds=5)


def test_good_and_easy_never_reschedule_same_day_via_learning_steps(db_session):
    """记得/轻松 must not bounce back in 10m/1h learning or relearning steps."""
    from datetime import timedelta

    from fsrs import State

    palace = _palace(db_session)

    # First Good on a brand-new card would otherwise be ~1h (learning step).
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id="s-first-good",
        operation_id="op-first-good",
        rating_scope="single",
    )
    first = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
    first_raw = first.raw_due_at or first.due_at
    first_delta = first_raw - (first.last_review_at or first_raw)
    assert first_delta >= timedelta(days=1) - timedelta(seconds=5)
    assert int(first.state) == int(State.Review)

    # Hard puts the card into a short relearning window…
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=2,
        study_session_id="s-relearn",
        operation_id="op-relearn-hard",
        rating_scope="single",
    )
    # …then Good must still floor to ≥1 day, not the 1h relearning step.
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id="s-relearn",
        operation_id="op-relearn-good",
        rating_scope="single",
    )
    recovered = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="b").one()
    recovered_raw = recovered.raw_due_at or recovered.due_at
    recovered_delta = recovered_raw - (recovered.last_review_at or recovered_raw)
    assert recovered_delta >= timedelta(days=1) - timedelta(seconds=5)
    assert int(recovered.state) == int(State.Review)

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=4,
        study_session_id="s-easy",
        operation_id="op-easy",
        rating_scope="single",
    )
    easy = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a").one()
    easy_raw = easy.raw_due_at or easy.due_at
    easy_delta = easy_raw - (easy.last_review_at or easy_raw)
    assert easy_delta >= timedelta(days=3) - timedelta(seconds=5)


def test_child_rating_overrides_previous_batch_and_undo_restores(db_session):
    palace = _palace(db_session)
    rate_nodes(db_session, palace_id=palace.id, node_uid="a", rating=4, study_session_id="s1", operation_id="op1")
    rate_nodes(db_session, palace_id=palace.id, node_uid="a1", rating=1, study_session_id="s1", operation_id="op2", rating_scope="single")
    state = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a1").one()
    assert state.state_source == "manual"
    undone = undo_rating_operation(db_session, operation_id="op2", study_session_id="s1")
    assert undone["undone"] is True
    restored = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a1").one()
    assert restored.stability and restored.stability > 0


def test_projection_excludes_root_and_reports_due_nodes(db_session):
    palace = _palace(db_session)
    projection = get_palace_memory_projection(db_session, palace.id)
    assert projection["node_count"] == 3
    # First-learn: unlearned tree nodes are formal-due so new palaces enter review.
    assert projection["due_node_count"] == 3
    assert projection.get("uninitialized_node_count", 0) == 3
    assert projection["mastery_percent"] == 0
    assert projection["has_due_review"] is True
    assert projection["review_entry_mode"] in {"node", "palace"}
    assert isinstance(projection["review_branch_summaries"], list)
    assert len(projection["review_branch_summaries"]) >= 2
    assert all("branch_uid" in row for row in projection["review_branch_summaries"])
    assert all("status" in row for row in projection["review_branch_summaries"])


def test_due_rollup_skips_ratings_and_is_request_cached(db_session):
    palace = _palace(db_session)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=1,
        study_session_id="s-rollup",
        operation_id="op-rollup",
        rating_scope="single",
    )
    full = get_palace_memory_projection(db_session, palace.id, include_ratings=True)
    rollup = get_palace_due_rollup(db_session, palace.id)
    assert rollup["due_node_count"] == full["due_node_count"]
    assert rollup["node_count"] == full["node_count"]
    assert all(item.get("rating") is None for item in rollup["nodes"])
    # Same request/session should reuse rollup without recomputing rating queries.
    again = get_palace_due_rollup(db_session, palace.id)
    assert again["palace_id"] == rollup["palace_id"]
    assert again["due_node_count"] == rollup["due_node_count"]


def test_mastery_trend_uses_only_completed_formal_review_receipts(db_session):
    palace = _palace(db_session)
    assert get_palace_mastery_trend(db_session, palace.id)["points"] == []

    rate_nodes(
        db_session, palace_id=palace.id, node_uid="a1", rating=4,
        study_session_id="practice-session", operation_id="trend-a1", rating_scope="single",
        source_scene="practice",
    )
    rate_nodes(
        db_session, palace_id=palace.id, node_uid="b", rating=1,
        study_session_id="practice-session", operation_id="trend-b", rating_scope="single",
        source_scene="practice",
    )
    assert get_palace_mastery_trend(db_session, palace.id)["points"] == []

    sessions = [
        StudySession(
            id="formal-later", status="completed", scene="review", target_type="palace",
            palace_id=palace.id, title="formal later",
            started_at=datetime(2026, 7, 16, 10, 0), ended_at=datetime(2026, 7, 16, 10, 30),
            summary_json=json.dumps(
                {"completion_receipt": {"mastery_progress": 0.6, "mastery_percent": 60}}
            ),
        ),
        StudySession(
            id="formal-earlier", status="completed", scene="review", target_type="palace",
            palace_id=palace.id, title="formal earlier",
            started_at=datetime(2026, 7, 15, 9, 0), ended_at=datetime(2026, 7, 15, 9, 20),
            summary_json=json.dumps(
                {"completion_receipt": {"mastery_progress": 0.4, "mastery_percent": 40}}
            ),
        ),
        StudySession(
            id="active-formal", status="active", scene="review", target_type="palace",
            palace_id=palace.id, title="active", started_at=datetime(2026, 7, 16, 11, 0),
            summary_json=json.dumps(
                {"completion_receipt": {"mastery_progress": 0.9, "mastery_percent": 90}}
            ),
        ),
        StudySession(
            id="legacy-completed", status="completed", scene="review",
            target_type="review_schedule", palace_id=palace.id, title="legacy",
            started_at=datetime(2026, 7, 14, 8, 0), ended_at=datetime(2026, 7, 14, 8, 10),
            summary_json="{}",
        ),
        StudySession(
            id="practice-completed", status="completed", scene="practice", target_type="palace",
            palace_id=palace.id, title="practice",
            started_at=datetime(2026, 7, 16, 12, 0), ended_at=datetime(2026, 7, 16, 12, 10),
            summary_json=json.dumps(
                {"completion_receipt": {"mastery_progress": 1.0, "mastery_percent": 100}}
            ),
        ),
    ]
    db_session.add_all(sessions)
    db_session.commit()

    assert get_palace_mastery_trend(db_session, palace.id)["points"] == [
        {"at": "2026-07-15T09:20:00", "mastery_progress": 0.4, "mastery_percent": 40},
        {"at": "2026-07-16T10:30:00", "mastery_progress": 0.6, "mastery_percent": 60},
    ]


def test_mastery_trend_ignores_timer_ghost_review_rows(db_session):
    """Leave/autosave timer rows used to be scene=review without receipts."""
    palace = _palace(db_session)
    db_session.add_all(
        [
            StudySession(
                id="ghost-saved",
                status="completed",
                scene="review",
                target_type="palace",
                palace_id=palace.id,
                title="ghost saved",
                started_at=datetime(2026, 7, 19, 20, 0),
                ended_at=datetime(2026, 7, 19, 20, 10),
                completion_method="saved",
                summary_json=json.dumps({"scene_segments": [], "duration_edited": False}),
            ),
            StudySession(
                id="ghost-left",
                status="completed",
                scene="review",
                target_type="palace",
                palace_id=palace.id,
                title="ghost left",
                started_at=datetime(2026, 7, 19, 21, 0),
                ended_at=datetime(2026, 7, 19, 21, 5),
                completion_method="left_page",
                summary_json=json.dumps({"client_source": "desktop"}),
            ),
        ]
    )
    db_session.commit()

    assert get_palace_mastery_trend(db_session, palace.id)["points"] == []


def test_subtree_skip_direct_preserves_child_direct_rating(db_session):
    palace = _palace(db_session)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a1",
        rating=1,
        study_session_id="s1",
        operation_id="op-child",
        rating_scope="single",
        source_scene="practice",
    )
    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=4,
        study_session_id="s1",
        operation_id="op-parent-skip",
        rating_scope="subtree",
        conflict_policy="skip_direct",
        source_scene="practice",
    )
    assert set(result["affected_node_uids"]) == {"a"}
    child = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a1").one()
    parent = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a").one()
    assert child.state_source == "manual"
    assert parent.state_source == "manual"
    # Child kept Again (1); parent got Easy (4) — stability should differ
    assert parent.stability is not None
    assert child.stability is not None


def test_subtree_skip_direct_preserves_batch_inherited_grandchildren(db_session):
    """避开 must keep grandchild scores inherited from a prior child subtree rating.

    Tree: parent (p) → child (c) → grandchild (g).
    Rate c as Hard (subtree) → c direct Hard, g batch_inherited Hard.
    Rate p as Easy with skip_direct → only p is updated; c and g stay Hard.
    """
    from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent

    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {
                    "data": {"uid": "p", "text": "Parent"},
                    "children": [
                        {
                            "data": {"uid": "c", "text": "Child"},
                            "children": [
                                {"data": {"uid": "g", "text": "Grandchild"}, "children": []},
                            ],
                        },
                        {"data": {"uid": "sib", "text": "Sibling"}, "children": []},
                    ],
                }
            ],
        }
    }
    palace = Palace(
        title="Skip inherited",
        description="",
        difficulty=0,
        review_mode="review",
        editor_doc=json.dumps(document),
    )
    db_session.add(palace)
    db_session.commit()

    child_result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="c",
        rating=2,  # 困难
        study_session_id="s-skip-g",
        operation_id="op-child-subtree",
        rating_scope="subtree",
        source_scene="practice",
    )
    assert set(child_result["affected_node_uids"]) == {"c", "g"}
    origins = {
        row.node_uid: row.evidence_origin
        for row in db_session.query(MindMapRecallEvent)
        .filter_by(study_session_id="s-skip-g", palace_id=palace.id)
        .all()
    }
    assert origins["c"] == "direct"
    assert origins["g"] == "batch_inherited"

    before_g = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="g").one()
    before_c = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="c").one()
    before_g_stability = before_g.stability
    before_c_stability = before_c.stability

    parent_result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="p",
        rating=4,  # 轻松
        study_session_id="s-skip-g",
        operation_id="op-parent-skip",
        rating_scope="subtree",
        conflict_policy="skip_direct",
        source_scene="practice",
    )
    # Unrated sibling still gets parent score; already-rated c/g are skipped.
    assert set(parent_result["affected_node_uids"]) == {"p", "sib"}

    after_g = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="g").one()
    after_c = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="c").one()
    after_p = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="p").one()
    after_sib = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="sib").one()
    assert after_g.stability == before_g_stability
    assert after_c.stability == before_c_stability
    assert after_p.state_source == "manual"
    assert after_sib.state_source == "manual"

    # Latest events for c/g remain Hard (2); p/sib are Easy (4).
    latest = {}
    for row in (
        db_session.query(MindMapRecallEvent)
        .filter_by(study_session_id="s-skip-g", palace_id=palace.id)
        .order_by(MindMapRecallEvent.occurred_at.desc(), MindMapRecallEvent.created_at.desc())
        .all()
    ):
        latest.setdefault(row.node_uid, row.rating)
    assert latest["c"] == 2
    assert latest["g"] == 2
    assert latest["p"] == 4
    assert latest["sib"] == 4


def test_subtree_overwrite_replaces_child_direct_rating(db_session):
    palace = _palace(db_session)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a1",
        rating=1,
        study_session_id="s1",
        operation_id="op-child2",
        rating_scope="single",
        source_scene="practice",
    )
    before_child = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a1").one()
    before_stability = before_child.stability
    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=4,
        study_session_id="s1",
        operation_id="op-parent-overwrite",
        rating_scope="subtree",
        conflict_policy="overwrite",
        source_scene="practice",
    )
    assert set(result["affected_node_uids"]) == {"a", "a1"}
    after_child = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a1").one()
    assert after_child.stability != before_stability or after_child.difficulty != before_child.difficulty


def test_content_fingerprint_change_reuses_existing_node_state(db_session):
    """Edited node text must not INSERT a second review_node_states row (UNIQUE crash → HTTP 500)."""
    palace = _palace(db_session)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id="s-fp",
        operation_id="op-fp-1",
        rating_scope="subtree",
        source_scene="practice",
    )
    states_before = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id)
        .order_by(ReviewNodeState.node_uid)
        .all()
    )
    assert {row.node_uid for row in states_before} == {"a", "a1"}
    old_ids = {row.node_uid: row.id for row in states_before}

    document = json.loads(palace.editor_doc or "{}")
    for node in document["root"]["children"]:
        if node["data"]["uid"] == "a":
            node["data"]["text"] = "A edited"
            for child in node.get("children") or []:
                if child["data"]["uid"] == "a1":
                    child["data"]["text"] = "A1 edited"
    palace.editor_doc = json.dumps(document)
    db_session.commit()

    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=4,
        study_session_id="s-fp",
        operation_id="op-fp-2",
        rating_scope="subtree",
        source_scene="practice",
    )
    assert set(result["affected_node_uids"]) == {"a", "a1"}
    states_after = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id)
        .order_by(ReviewNodeState.node_uid)
        .all()
    )
    assert len(states_after) == 2
    for row in states_after:
        assert row.id == old_ids[row.node_uid]
        assert row.content_fingerprint  # refreshed after content edit
        assert row.state_source == "manual"

def test_rate_nodes_returns_slim_payload_without_full_node_details(db_session):
    """Rating hot path must not ship full per-node projection arrays."""
    palace = _palace(db_session)
    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id="s-slim",
        operation_id="op-slim",
        rating_scope="single",
        source_scene="practice",
    )
    assert result["affected_node_uids"] == ["b"]
    assert result["nodes"] == []
    assert "mastery_progress" in result
    assert "memory_health" in result
    assert result["undo_available"] is True


def test_rate_nodes_avoids_per_node_state_selects_on_subtree(db_session):
    """Subtree rating should batch-load ReviewNodeState, not SELECT per selected uid."""
    from sqlalchemy import event

    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {
                    "data": {"uid": f"n{i}", "text": f"N{i}"},
                    "children": [
                        {"data": {"uid": f"n{i}-c", "text": f"N{i}c"}, "children": []}
                    ],
                }
                for i in range(12)
            ],
        }
    }
    palace = Palace(
        title="perf",
        description="",
        difficulty=0,
        review_mode="review",
        editor_doc=json.dumps(document),
    )
    db_session.add(palace)
    db_session.commit()

    # Seed one leaf so after-rating has mixed new + existing rows.
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="n0-c",
        rating=3,
        study_session_id="s-seed",
        operation_id="op-seed",
        rating_scope="single",
        source_scene="practice",
    )

    statements: list[str] = []
    bind = db_session.get_bind()

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        if "review_node_states" in statement.lower() and statement.lstrip().upper().startswith(
            "SELECT"
        ):
            statements.append(statement)

    event.listen(bind, "before_cursor_execute", record)
    try:
        result = rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid="n1",
            rating=4,
            study_session_id="s-perf",
            operation_id="op-perf-subtree",
            rating_scope="subtree",
            source_scene="practice",
        )
    finally:
        event.remove(bind, "before_cursor_execute", record)

    assert set(result["affected_node_uids"]) == {"n1", "n1-c"}
    # One palace-wide state load for before/after + write loop; never 2+ per-uid SELECTs.
    assert len(statements) <= 2, statements
    assert result["nodes"] == []
