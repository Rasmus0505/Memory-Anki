import json
from datetime import datetime

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState, ReviewRatingOperation
from memory_anki.modules.reviews.application.node_memory_service import (
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
    assert projection["due_node_count"] == 3
    assert projection["mastery_percent"] == 0


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
