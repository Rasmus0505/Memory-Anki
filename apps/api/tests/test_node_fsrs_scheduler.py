import json

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState, ReviewRatingOperation
from memory_anki.modules.reviews.application.node_memory_service import (
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
