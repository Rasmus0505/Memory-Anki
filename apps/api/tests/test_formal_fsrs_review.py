import json
from datetime import UTC, datetime, timedelta

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.reviews.application.formal_review_service import (
    complete_formal_review,
    formal_review_completion_summary,
    get_fsrs_load_forecast,
    get_fsrs_queue_payload,
    rate_unrated_formal_review_nodes,
    resolve_formal_review_session,
    start_or_resume_formal_review,
)
from memory_anki.modules.reviews.application.node_memory_service import (
    rate_nodes,
)
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.core.time import utc_now_naive


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
    assert payload["reviews"][0]["today_review_count"] == 0


def test_completion_receipt_exposes_next_wave_node_count(db_session):
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)
    for uid in ("a", "b"):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid=uid,
            rating=3,
            study_session_id=row.id,
            operation_id=f"next-wave-{uid}",
            rating_scope="single",
            recall_round="first",
        )
    result = complete_formal_review(
        db_session,
        row,
        duration_seconds=40,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()
    assert result["remaining_due_node_count"] == 0
    assert result["next_review_node_count"] >= 1
    assert result["next_review_entry_mode"] in {"node", "palace"}
    assert result["today_review_count"] == 1
    assert result["last_review_at"] is not None
    assert result["previous_mastery_percent"] is None

    payload = get_fsrs_queue_payload(db_session)
    # After Good ratings, palace may leave due queue; if still listed, count is 1.
    for item in payload["reviews"] + payload["later_today_reviews"]:
        if item["palace_id"] == palace.id:
            assert item["today_review_count"] == 1


def test_completion_summary_carries_previous_mastery_and_last_review(db_session):
    palace = _palace(db_session)
    first = start_or_resume_formal_review(db_session, palace.id)
    for uid in ("a", "b"):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid=uid,
            rating=3,
            study_session_id=first.id,
            operation_id=f"prev-mastery-first-{uid}",
            rating_scope="single",
            recall_round="first",
        )
    first_receipt = complete_formal_review(
        db_session,
        first,
        duration_seconds=20,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()
    first_mastery = first_receipt["mastery_percent"]
    first_ended = first_receipt["last_review_at"]
    assert first_ended is not None

    # Force another due wave so a second formal session can start.
    past = utc_now_naive() - timedelta(days=2)
    for row in db_session.query(ReviewNodeState).filter_by(palace_id=palace.id).all():
        row.due_at = past
        row.last_review_at = past - timedelta(days=1)
    db_session.commit()

    second = start_or_resume_formal_review(db_session, palace.id)
    assert second.id != first.id
    summary = formal_review_completion_summary(db_session, second)
    assert summary["last_review_at"] == first_ended
    assert summary["previous_mastery_percent"] == first_mastery

    for uid in summary.get("unrated_node_uids") or []:
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid=uid,
            rating=4,
            study_session_id=second.id,
            operation_id=f"prev-mastery-second-{uid}",
            rating_scope="single",
            recall_round="first",
        )
    second_receipt = complete_formal_review(
        db_session,
        second,
        duration_seconds=25,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()
    assert second_receipt["previous_mastery_percent"] == first_mastery
    assert second_receipt["last_review_at"] is not None
    assert second_receipt["last_review_at"] != first_ended


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


def test_completion_reanchors_hard_schedule_after_long_session(db_session):
    """困难 interval starts at complete time, not mid-session click time.

    Regression: rate Hard early in a long session → 30min cap expires before
    the learner clicks 完成 → palace immediately reappears as due.
    """
    palace = _palace(db_session)
    row = start_or_resume_formal_review(db_session, palace.id)

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=2,
        study_session_id=row.id,
        operation_id="hard-early",
        rating_scope="single",
        source_scene="formal_review",
        recall_round="first",
    )
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id=row.id,
        operation_id="good-later",
        rating_scope="single",
        source_scene="formal_review",
        recall_round="first",
    )

    hard = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    good = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )
    hard_interval = hard.due_at - hard.last_review_at
    good_interval = good.due_at - good.last_review_at
    assert hard_interval <= timedelta(minutes=30, seconds=5)

    # Simulate a long session: Hard was scored ~45 minutes before completion.
    past = utc_now_naive() - timedelta(minutes=45)
    hard.last_review_at = past
    hard.due_at = past + hard_interval
    good.last_review_at = past + timedelta(minutes=40)
    good.due_at = good.last_review_at + good_interval
    db_session.commit()

    # Without finalization, Hard would already be overdue at complete time.
    assert hard.due_at < utc_now_naive()

    before_complete = utc_now_naive()
    result = complete_formal_review(
        db_session,
        row,
        duration_seconds=2700,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    db_session.commit()
    after_complete = utc_now_naive()

    hard = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    good = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )

    assert hard.last_review_at is not None
    assert before_complete <= hard.last_review_at <= after_complete + timedelta(seconds=1)
    assert hard.due_at == hard.last_review_at + hard_interval
    assert hard.due_at > after_complete - timedelta(seconds=1)
    assert (hard.due_at - hard.last_review_at) <= timedelta(minutes=30, seconds=5)

    assert good.last_review_at == hard.last_review_at
    assert good.due_at == good.last_review_at + good_interval

    # Fully rated session: nothing should remain due right after complete.
    assert result["unrated_due_node_count"] == 0
    assert result["remaining_due_node_count"] == 0


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


def test_legacy_active_review_without_frozen_scope_does_not_hijack_resume(db_session):
    """Migrated session-progress rows must not become formal FSRS sessions."""
    palace = _palace(db_session)
    legacy = StudySession(
        id="session-progress-legacy",
        status="active",
        scene="review",
        target_type="review_schedule",
        target_id=999,
        palace_id=palace.id,
        title="legacy",
        started_at=utc_now_naive(),
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps({"migrated_from": "session_progress"}),
    )
    db_session.add(legacy)
    db_session.commit()

    formal = start_or_resume_formal_review(db_session, palace.id)
    assert formal.id != legacy.id
    assert formal.id.startswith("review-")
    assert set(json.loads(formal.summary_json)["frozen_due_node_uids"]) == {"a", "b"}

    db_session.refresh(legacy)
    assert legacy.status == "abandoned"
    assert json.loads(legacy.summary_json).get("superseded_reason") == "missing_frozen_due_node_uids"

    # Resolving the old id must also promote to a real formal session.
    resolved = resolve_formal_review_session(db_session, "session-progress-legacy")
    assert resolved.id == formal.id


def test_completion_summary_counts_ratings_when_frozen_scope_missing(db_session):
    """Settlement must not show 0 scored after ratings land on a scope-less row."""
    palace = _palace(db_session)
    legacy = StudySession(
        id="session-progress-scopedless",
        status="active",
        scene="review",
        target_type="review_schedule",
        target_id=1001,
        palace_id=palace.id,
        title="legacy",
        started_at=utc_now_naive(),
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps({"migrated_from": "session_progress"}),
    )
    db_session.add(legacy)
    db_session.commit()

    # Subtree ratings (PWA flip-card default) are not gated by frozen scope; they
    # still write session events that settlement must count when scope is empty.
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id=legacy.id,
        operation_id="legacy-rate-a",
        rating_scope="subtree",
        source_scene="formal_review",
        recall_round="first",
    )
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=4,
        study_session_id=legacy.id,
        operation_id="legacy-rate-b",
        rating_scope="subtree",
        source_scene="formal_review",
        recall_round="first",
    )

    summary = formal_review_completion_summary(db_session, legacy)
    assert summary["rated_node_count"] == 2
    assert summary["scope_node_count"] == 2
    assert summary["unrated_due_node_count"] == 0
    assert summary["rating_counts"]["记得"] == 1
    assert summary["rating_counts"]["轻松"] == 1
    assert summary["ratings"]["a"] == 3
    assert summary["ratings"]["b"] == 4


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


def test_queue_orders_by_earliest_due_first(db_session):
    """Long-overdue palaces must surface before recently-due ones."""
    older = _palace(db_session)
    older.title = "Older overdue"
    newer = _palace(db_session)
    newer.title = "Newer overdue"
    db_session.commit()
    _set_all_due_at(db_session, newer.id, datetime.now(UTC) - timedelta(hours=1))
    _set_all_due_at(db_session, older.id, datetime.now(UTC) - timedelta(days=5))

    queue = get_fsrs_queue_payload(db_session)
    ids = [item["palace_id"] for item in queue["reviews"]]
    assert ids.index(older.id) < ids.index(newer.id)

    by_nodes = get_fsrs_queue_payload(db_session, sort_by="due_nodes_desc")
    assert [item["palace_id"] for item in by_nodes["reviews"]] == ids  # same counts; due tie-break

    by_title = get_fsrs_queue_payload(db_session, sort_by="title_asc")
    titles = [item["palace"]["title"] for item in by_title["reviews"]]
    assert titles == sorted(titles, key=str.casefold)


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
