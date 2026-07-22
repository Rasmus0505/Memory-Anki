"""Tests for legacy FSRS inflation repair and runtime clock normalization."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
)
from memory_anki.modules.memory.application.legacy_fsrs_repair import (
    is_inflated_legacy_jump,
    repair_legacy_fsrs_inflation,
)
from memory_anki.modules.memory.application.node_memory_service import (
    get_palace_memory_projection,
    rate_nodes,
)


def _fingerprint(text: str) -> str:
    import hashlib

    payload = {"text": text, "note": ""}
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def _doc(*uids: str) -> str:
    children = [{"data": {"uid": uid, "text": uid.upper()}, "children": []} for uid in uids]
    return json.dumps({"root": {"data": {"uid": "root", "text": "root"}, "children": children}})

def _palace(session, *uids: str) -> Palace:
    palace = Palace(
        title="legacy-repair",
        description="",
        difficulty=0,
        review_mode="review",
        editor_doc=_doc(*uids),
    )
    session.add(palace)
    session.commit()
    return palace


def _seed_legacy(
    session,
    palace_id: int,
    node_uid: str,
    *,
    stability: float = 15.0,
    last_review: datetime,
    due: datetime,
) -> ReviewNodeState:
    row = ReviewNodeState(
        palace_id=palace_id,
        node_uid=node_uid,
        state=2,
        step=None,
        stability=stability,
        difficulty=5.0,
        due_at=due,
        last_review_at=last_review,
        desired_retention=0.9,
        maximum_interval=180,
        content_fingerprint=_fingerprint(node_uid.upper()),
        state_source="legacy_estimate",
        scheduler_version="fsrs-6.3.1",
        parameter_version="legacy-stage-estimate",
    )
    session.add(row)
    session.commit()
    return row


def test_is_inflated_legacy_jump_detects_overdue_good():
    before = {
        "state_source": "legacy_estimate",
        "parameter_version": "legacy-stage-estimate",
        "stability": 15.0,
    }
    after = {"stability": 65.5, "state_source": "manual"}
    assert is_inflated_legacy_jump(before, after) is True
    assert is_inflated_legacy_jump(before, {"stability": 16.0}) is False
    assert is_inflated_legacy_jump({"state_source": "manual", "stability": 15.0}, after) is False


def test_runtime_legacy_rating_does_not_inflate_to_mastery_horizon(db_session):
    palace = _palace(db_session, "a")
    last = datetime(2026, 6, 17, 22, 19, 0)
    due = datetime(2026, 7, 17, 22, 19, 0)
    _seed_legacy(db_session, palace.id, "a", stability=15.0, last_review=last, due=due)

    result = rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id="s-legacy",
        operation_id="op-legacy",
        rating_scope="single",
    )
    row = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a").one()
    # Without clock normalize this would be ~65; with normalize it stays well below horizon.
    assert float(row.stability or 0) < 30.0
    assert result["mastery_percent"] < 50
    assert row.state_source == "manual"


def test_repair_restores_single_session_legacy_good_inflation(db_session):
    palace = _palace(db_session, "a", "b")
    last = datetime(2026, 6, 17, 22, 19, 0)
    due = datetime(2026, 7, 17, 22, 19, 0)
    for uid in ("a", "b"):
        _seed_legacy(db_session, palace.id, uid, stability=15.0, last_review=last, due=due)

    # Bypass runtime protection by writing an inflated snapshot as if an old rating
    # already happened (simulate pre-fix production state).
    inflated_s = 65.53569331332181
    for index, uid in enumerate(("a", "b")):
        row = (
            db_session.query(ReviewNodeState)
            .filter_by(palace_id=palace.id, node_uid=uid)
            .one()
        )
        before = {
            "state": 2,
            "step": None,
            "stability": 15.0,
            "difficulty": 5.0,
            "due_at": due.isoformat(),
            "last_review_at": last.isoformat(),
            "desired_retention": 0.9,
            "maximum_interval": 180,
            "content_fingerprint": row.content_fingerprint,
            "state_source": "legacy_estimate",
            "scheduler_version": "fsrs-6.3.1",
            "parameter_version": "legacy-stage-estimate",
        }
        op_id = f"op-inflated-{index}"
        op = ReviewRatingOperation(
            id=op_id,
            study_session_id="review-session-1",
            palace_id=palace.id,
            root_node_uid=uid,
            rating=3,
            rating_scope="single",
            affected_node_count=1,
            created_at=datetime(2026, 7, 20, 6, 10, 18) + timedelta(milliseconds=index),
        )
        db_session.add(op)
        row.stability = inflated_s
        row.state = 2
        row.due_at = datetime(2026, 9, 24, 6, 10, 18)
        row.last_review_at = datetime(2026, 7, 20, 6, 10, 18)
        row.state_source = "manual"
        row.parameter_version = "default"
        after = {
            "state": 2,
            "step": None,
            "stability": inflated_s,
            "difficulty": 4.99,
            "due_at": row.due_at.isoformat(),
            "last_review_at": row.last_review_at.isoformat(),
            "desired_retention": 0.9,
            "maximum_interval": 180,
            "content_fingerprint": row.content_fingerprint,
            "state_source": "manual",
            "scheduler_version": "fsrs-6.3.1",
            "parameter_version": "default",
        }
        db_session.add(
            ReviewRatingOperationItem(
                operation_id=op_id,
                palace_id=palace.id,
                node_uid=uid,
                event_id=f"ev-{uid}",
                before_state_json=json.dumps(before),
                after_state_json=json.dumps(after),
            )
        )
    db_session.add(
        StudySession(
            id="review-session-1",
            status="completed",
            scene="review",
            target_type="palace",
            target_id=palace.id,
            palace_id=palace.id,
            title=palace.title,
            started_at=datetime(2026, 7, 20, 6, 0, 0),
            ended_at=datetime(2026, 7, 20, 6, 10, 20),
            effective_seconds=100,
            completion_method="manual_complete",
            summary_json=json.dumps(
                {
                    "completion_receipt": {
                        "mastery_progress": 1.0,
                        "mastery_percent": 100,
                        "memory_health": 1.0,
                        "memory_health_percent": 100,
                    }
                }
            ),
        )
    )
    db_session.commit()

    before_projection = get_palace_memory_projection(db_session, palace.id)
    assert before_projection["mastery_percent"] == 100

    dry = repair_legacy_fsrs_inflation(db_session, palace_id=palace.id, apply=False)
    assert dry["nodes_still_inflated"] == 2
    assert dry["apply"] is False

    report = repair_legacy_fsrs_inflation(
        db_session,
        palace_id=palace.id,
        apply=True,
        normalize_legacy_clocks=True,
        now=datetime(2026, 7, 20, 12, 0, 0),
    )
    assert report["nodes_repaired"] == 2
    assert report["operations_marked_undone"] == 2

    rows = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id)
        .order_by(ReviewNodeState.node_uid)
        .all()
    )
    assert all(abs(float(r.stability or 0) - 15.0) < 1e-6 for r in rows)
    assert all(r.state_source == "legacy_estimate" for r in rows)
    # Clocks normalized to repair "now" so next Good is not weeks-overdue.
    assert all(r.due_at == datetime(2026, 7, 20, 12, 0, 0) for r in rows)

    after_projection = get_palace_memory_projection(db_session, palace.id)
    assert after_projection["mastery_percent"] == 25
    assert after_projection["mastered"] is False

    undone = db_session.query(ReviewRatingOperation).filter(
        ReviewRatingOperation.undone_at.is_not(None)
    ).count()
    assert undone == 2

    session_row = db_session.get(StudySession, "review-session-1")
    receipt = json.loads(session_row.summary_json)["completion_receipt"]
    assert receipt["mastery_percent"] == 25
    assert "repaired_legacy_inflation_at" in receipt


def test_repair_replays_later_ratings_after_skipping_first_jump(db_session):
    palace = _palace(db_session, "a")
    last = datetime(2026, 6, 10, 0, 0, 0)
    due = datetime(2026, 7, 10, 0, 0, 0)
    _seed_legacy(db_session, palace.id, "a", stability=7.0, last_review=last, due=due)
    row = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a").one()

    before_legacy = {
        "state": 2,
        "step": None,
        "stability": 7.0,
        "difficulty": 5.0,
        "due_at": due.isoformat(),
        "last_review_at": last.isoformat(),
        "desired_retention": 0.9,
        "maximum_interval": 180,
        "content_fingerprint": row.content_fingerprint,
        "state_source": "legacy_estimate",
        "scheduler_version": "fsrs-6.3.1",
        "parameter_version": "legacy-stage-estimate",
    }
    after_jump = {
        **before_legacy,
        "stability": 47.0,
        "state_source": "manual",
        "parameter_version": "default",
        "last_review_at": datetime(2026, 7, 18, 12, 0, 0).isoformat(),
        "due_at": datetime(2026, 8, 20, 12, 0, 0).isoformat(),
    }
    op1 = ReviewRatingOperation(
        id="op-first",
        study_session_id="s1",
        palace_id=palace.id,
        root_node_uid="a",
        rating=3,
        rating_scope="single",
        affected_node_count=1,
        created_at=datetime(2026, 7, 18, 12, 0, 0),
    )
    op2 = ReviewRatingOperation(
        id="op-hard",
        study_session_id="s2",
        palace_id=palace.id,
        root_node_uid="a",
        rating=2,
        rating_scope="single",
        affected_node_count=1,
        created_at=datetime(2026, 7, 20, 5, 0, 0),
    )
    db_session.add_all([op1, op2])
    db_session.add(
        ReviewRatingOperationItem(
            operation_id="op-first",
            palace_id=palace.id,
            node_uid="a",
            event_id="ev1",
            before_state_json=json.dumps(before_legacy),
            after_state_json=json.dumps(after_jump),
        )
    )
    # Simulate re-inflated state: later Hard replayed against overdue legacy clocks
    # (production bug before clock normalize) left S near the first jump.
    row.stability = 32.0
    row.state_source = "manual"
    row.parameter_version = "default"
    row.last_review_at = datetime(2026, 7, 20, 5, 0, 0)
    row.due_at = datetime(2026, 8, 20, 5, 0, 0)
    after_hard = {
        **after_jump,
        "stability": 15.0,
        "last_review_at": row.last_review_at.isoformat(),
        "due_at": row.due_at.isoformat(),
    }
    db_session.add(
        ReviewRatingOperationItem(
            operation_id="op-hard",
            palace_id=palace.id,
            node_uid="a",
            event_id="ev2",
            before_state_json=json.dumps(after_jump),
            after_state_json=json.dumps(after_hard),
            before_rating=3,
        )
    )
    db_session.commit()

    report = repair_legacy_fsrs_inflation(
        db_session,
        palace_id=palace.id,
        apply=True,
        now=datetime(2026, 7, 20, 12, 0, 0),
    )
    assert report["nodes_repaired"] == 1
    row = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id, node_uid="a").one()
    # Restored to S=7, clocks normalized, then Hard — must not re-inflate to ~32/47.
    assert float(row.stability or 0) < 20.0
    assert row.state_source == "manual"
    assert db_session.get(ReviewRatingOperation, "op-first").undone_at is not None
    assert db_session.get(ReviewRatingOperation, "op-hard").undone_at is None
