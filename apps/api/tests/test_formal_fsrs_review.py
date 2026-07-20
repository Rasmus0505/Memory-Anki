import json
from datetime import UTC, datetime, timedelta

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.reviews.application.formal_review_service import (
    complete_formal_review,
    formal_review_completion_summary,
    get_fsrs_load_forecast,
    get_fsrs_queue_payload,
    rate_unrated_formal_review_nodes,
    start_or_resume_formal_review,
)
from memory_anki.modules.reviews.application.node_memory_service import (
    rate_nodes,
)
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent


def _palace(session):
    palace = Palace(
        title="FSRS formal",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {"data": {"uid": "a", "text": "A"}, "children": []},
                        {"data": {"uid": "b", "text": "B"}, "children": []},
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.commit()
    return palace


def test_fsrs_queue_uses_node_due_state_not_legacy_schedules(db_session):
    palace = _palace(db_session)
    payload = get_fsrs_queue_payload(db_session)
    assert payload["due_count"] == 2
    assert payload["reviews"][0]["palace_id"] == palace.id
    assert payload["reviews"][0]["due_node_count"] == 2
    assert payload["reviews"][0]["review_entry_mode"] in {"node", "palace"}


def test_formal_session_freezes_scope_and_unrated_nodes_stay_due(db_session):
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)
    assert set(json.loads(row.summary_json)["frozen_due_node_uids"]) == {"a", "b"}
    assert start_or_resume_formal_review(db_session, palace.id).id == row.id

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id=row.id,
        operation_id="formal-op",
        rating_scope="single",
        recall_round="first",
    )
    summary = formal_review_completion_summary(db_session, row)
    assert summary["rated_node_count"] == 1
    assert summary["unrated_due_node_count"] == 1
    assert summary["unrated_node_uids"] == ["b"]

    result = complete_formal_review(
        db_session,
        row,
        duration_seconds=30,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()
    assert result["unrated_due_node_count"] == 1
    assert result["remaining_due_node_count"] >= 1


def test_rate_unrated_only_scores_missing_nodes_not_already_rated(db_session):
    """Settlement bulk score must fill unrated nodes without overwriting prior ratings."""
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=row.id,
        operation_id="prior-a",
        rating_scope="single",
        source_scene="formal_review",
        recall_round="first",
    )
    bulk = rate_unrated_formal_review_nodes(
        db_session,
        row,
        rating=4,
        operation_id="settlement-bulk",
    )
    assert bulk["affected_node_uids"] == ["b"]
    assert bulk["affected_node_count"] == 1
    assert bulk["skipped_rated_node_count"] == 1
    assert bulk["summary"]["rated_node_count"] == 2
    assert bulk["summary"]["unrated_due_node_count"] == 0
    assert bulk["summary"]["ratings"]["a"] == 1
    assert bulk["summary"]["ratings"]["b"] == 4

    events = (
        db_session.query(MindMapRecallEvent)
        .filter(MindMapRecallEvent.study_session_id == row.id)
        .all()
    )
    by_uid = {event.node_uid: event.rating for event in events}
    assert by_uid["a"] == 1
    assert by_uid["b"] == 4

    # Idempotent: second call with same batch id must not re-rate.
    again = rate_unrated_formal_review_nodes(
        db_session,
        row,
        rating=2,
        operation_id="settlement-bulk-2",
    )
    assert again["affected_node_count"] == 0
    assert again["summary"]["ratings"]["a"] == 1
    assert again["summary"]["ratings"]["b"] == 4


def test_recovered_formal_session_can_still_rate_single_nodes(db_session):
    """Recovered study-session status must not block formal single ratings."""
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)
    row.status = "recovered"
    db_session.commit()

    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id=row.id,
        operation_id="recovered-rate",
        rating_scope="single",
        source_scene="formal_review",
        recall_round="first",
    )
    assert "a" in set(result["affected_node_uids"])
    db_session.refresh(row)
    assert row.status == "active"


def test_completed_formal_session_rejects_rating_with_clear_message(db_session):
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)
    complete_formal_review(
        db_session,
        row,
        duration_seconds=10,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()

    try:
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid="a",
            rating=3,
            study_session_id=row.id,
            operation_id="after-complete",
            rating_scope="single",
            source_scene="formal_review",
            recall_round="first",
        )
        assert False, "expected completed session to reject rating"
    except ValueError as exc:
        assert "已结束" in str(exc)


def _set_all_due_at(session, palace_id: int, due_at: datetime) -> None:
    rate_nodes(
        session,
        palace_id=palace_id,
        node_uid="root",
        rating=3,
        study_session_id=f"forecast-seed-{palace_id}",
        operation_id=f"forecast-seed-{palace_id}",
        rating_scope="subtree",
        source_scene="practice",
    )
    session.query(ReviewNodeState).filter_by(palace_id=palace_id).update(
        {ReviewNodeState.due_at: due_at.replace(tzinfo=None)}
    )
    session.commit()


def test_queue_reports_later_today_and_forecast_from_node_due_at(db_session):
    palace = _palace(db_session)
    due_at = datetime.now(UTC) + timedelta(hours=1)
    _set_all_due_at(db_session, palace.id, due_at)

    queue = get_fsrs_queue_payload(db_session)
    forecast = get_fsrs_load_forecast(db_session, days=3)

    assert queue["due_count"] == 0
    assert queue["later_today_count"] == 2
    assert queue["later_today_reviews"][0]["next_due_at"] == due_at.isoformat()
    assert forecast["overdue_count"] == 0
    assert forecast["total_upcoming"] == 2
    assert sum(item["due_count"] for item in forecast["items"]) == 2


def test_queue_chapter_filter_and_daily_palace_limit(db_session):
    first = _palace(db_session)
    second = _palace(db_session)
    second.title = "FSRS second"
    subject = Subject(name="FSRS subject")
    chapter = Chapter(name="FSRS chapter", subject=subject)
    first.chapters.append(chapter)
    overdue_at = datetime.now(UTC) - timedelta(hours=1)
    _set_all_due_at(db_session, first.id, overdue_at)
    _set_all_due_at(db_session, second.id, overdue_at)
    db_session.add(Config(key="daily_max_reviews", value="1"))
    db_session.commit()

    limited = get_fsrs_queue_payload(db_session)
    chapter_queue = get_fsrs_queue_payload(db_session, chapter.id)

    assert len(limited["reviews"]) == 1
    assert limited["due_count"] == 2
    assert limited["overdue_count"] == 4
    assert [item["palace_id"] for item in chapter_queue["reviews"]] == [first.id]
    assert chapter_queue["chapter"]["id"] == chapter.id
    assert chapter_queue["chapter"]["subject"]["name"] == subject.name


def test_single_top_level_branch_uses_node_entry_mode(db_session):
    palace = Palace(
        title="single branch",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {
                            "data": {"uid": "branch", "text": "Branch"},
                            "children": [
                                {"data": {"uid": "leaf", "text": "Leaf"}, "children": []},
                            ],
                        },
                    ],
                }
            }
        ),
    )
    db_session.add(palace)
    db_session.commit()
    payload = get_fsrs_queue_payload(db_session)
    assert payload["reviews"][0]["review_entry_mode"] == "node"
    assert payload["reviews"][0]["primary_branch_title"] == "Branch"
    assert payload["reviews"][0]["review_entry_label"] == "节点复习"
    row = start_or_resume_formal_review(db_session, palace.id)
    summary = json.loads(row.summary_json)
    assert summary["review_entry_mode"] == "node"
    assert set(summary["frozen_due_node_uids"]) == {"branch", "leaf"}


def test_formal_subtree_rating_updates_non_due_descendants(db_session):
    """Parent subtree in formal review must cascade to non-due / out-of-frozen nodes."""
    palace = Palace(
        title="cascade",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {
                            "data": {"uid": "a", "text": "A"},
                            "children": [
                                {"data": {"uid": "a1", "text": "A1"}, "children": []},
                            ],
                        },
                        {"data": {"uid": "b", "text": "B"}, "children": []},
                    ],
                }
            }
        ),
    )
    db_session.add(palace)
    db_session.commit()
    # Mark a1 as not due yet, while a and b remain due for session freeze.
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a1",
        rating=4,
        study_session_id="seed-a1",
        operation_id="seed-a1",
        rating_scope="single",
        source_scene="practice",
    )
    before = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a1")
        .one()
    )
    before_due = before.due_at
    before_stability = before.stability

    row = start_or_resume_formal_review(db_session, palace.id)
    frozen = set(json.loads(row.summary_json)["frozen_due_node_uids"])
    assert "a1" not in frozen
    assert "a" in frozen

    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=2,
        study_session_id=row.id,
        operation_id="formal-subtree-cascade",
        rating_scope="subtree",
        source_scene="formal_review",
    )
    assert "a1" in set(result["affected_node_uids"])
    after = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a1")
        .one()
    )
    assert after.due_at != before_due or after.stability != before_stability
