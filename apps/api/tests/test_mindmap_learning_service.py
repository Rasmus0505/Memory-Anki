from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.mindmap_learning.application.learning_service import (
    create_recall_event,
    list_node_mastery,
    set_node_label,
)


def _palace(db_session):
    palace = Palace(title="Test", editor_doc='{"root":{"data":{"uid":"root","text":"Root"},"children":[{"data":{"uid":"n1","text":"One"},"children":[]}]}}')
    db_session.add(palace)
    db_session.commit()
    return palace


def _event(db_session, palace_id, event_id, session_id, rating, recall_round="first", supersedes=None, offset=0):
    return create_recall_event(db_session, {
        "id": event_id,
        "study_session_id": session_id,
        "palace_id": palace_id,
        "node_uid": "n1",
        "source_scene": "formal_review",
        "recall_round": recall_round,
        "rating": rating,
        "occurred_at": utc_now_naive() + timedelta(minutes=offset),
        "supersedes_event_id": supersedes,
    })


def test_recall_events_are_idempotent_and_corrections_replace_effective_rating(db_session):
    palace = _palace(db_session)
    _event(db_session, palace.id, "e1", "s1", 1)
    _event(db_session, palace.id, "e1", "s1", 1)
    _event(db_session, palace.id, "e2", "s1", 5, supersedes="e1", offset=1)
    assert db_session.query(MindMapRecallEvent).count() == 2
    item = list_node_mastery(db_session, palace.id)[0]
    assert item["status"] == "reinforce"
    assert item["recent_events"][-1]["rating"] == 5


def test_mastery_rules_and_manual_labels(db_session):
    palace = _palace(db_session)
    _event(db_session, palace.id, "e1", "s1", 5)
    _event(db_session, palace.id, "e2", "s2", 5, offset=1)
    assert list_node_mastery(db_session, palace.id)[0]["status"] == "stable"
    set_node_label(db_session, palace.id, "n1", "weak")
    assert list_node_mastery(db_session, palace.id, weak_only=True)[0]["status"] == "weak"
    set_node_label(db_session, palace.id, "n1", "mastered")
    assert list_node_mastery(db_session, palace.id, weak_only=True) == []


def test_failed_first_attempt_with_successful_retry_still_needs_reinforcement(db_session):
    palace = _palace(db_session)
    _event(db_session, palace.id, "e1", "s1", 1)
    _event(db_session, palace.id, "e2", "s1", 5, recall_round="weak_retry", offset=1)
    item = list_node_mastery(db_session, palace.id)[0]
    assert item["status"] == "reinforce"
    assert "纠错成功" in item["reason"]
