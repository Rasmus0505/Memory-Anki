"""Palace wave freeze / merge / reinforcement lifecycle tests."""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewWave,
    ReviewWaveItem,
)
from memory_anki.modules.memory.application.calibration_service import (
    diagnose_palace,
    preview_or_apply_calibration,
    undo_calibration,
)
from memory_anki.modules.memory.application.formal_review_service import (
    formal_review_session_payload,
    get_formal_review_scope,
    start_or_resume_formal_review,
)
from memory_anki.modules.memory.application.formal_review_settlement import (
    complete_formal_review,
)
from memory_anki.modules.memory.application.node_memory_service import (
    rate_nodes,
    undo_rating_operation,
)
from memory_anki.modules.memory.application.wave_service import (
    formal_due_node_uids,
    merge_new_due_into_wave,
    pause_formal_wave,
    start_reinforcement_wave_session,
)


def _seed_palace(session, *, node_uids: list[str] | None = None):
    uids = node_uids or ["a", "b", "c"]
    children = [{"data": {"uid": uid, "text": uid.upper()}, "children": []} for uid in uids]
    palace = Palace(
        title="Wave palace",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": children,
                }
            }
        ),
    )
    session.add(palace)
    session.flush()
    past = utc_now_naive() - timedelta(days=2)
    for uid in uids:
        session.add(
            ReviewNodeState(
                palace_id=palace.id,
                node_uid=uid,
                state=2,
                stability=5.0,
                difficulty=5.0,
                due_at=past,
                raw_due_at=past,
                last_review_at=past - timedelta(days=5),
                schedule_source="manual",
                content_fingerprint="",
            )
        )
    session.commit()
    return palace


def test_overdue_a_and_due_b_freeze_together(db_session):
    palace = _seed_palace(db_session, node_uids=["a", "b"])
    # A more overdue, B just due — both freeze together.
    a = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    a.due_at = utc_now_naive() - timedelta(days=5)
    a.raw_due_at = a.due_at
    b = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )
    b.due_at = utc_now_naive() - timedelta(minutes=1)
    b.raw_due_at = b.due_at
    db_session.commit()

    row = start_or_resume_formal_review(db_session, palace.id)
    payload = formal_review_session_payload(db_session, row)
    frozen = set(payload["frozen_due_node_uids"])
    assert frozen == {"a", "b"}
    assert payload.get("wave_id")


def test_new_due_after_start_requires_merge(db_session):
    palace = _seed_palace(db_session, node_uids=["a", "b", "c"])
    # Only a is due initially.
    for uid in ("b", "c"):
        row = (
            db_session.query(ReviewNodeState)
            .filter_by(palace_id=palace.id, node_uid=uid)
            .one()
        )
        row.due_at = utc_now_naive() + timedelta(days=3)
        row.raw_due_at = row.due_at
    db_session.commit()

    session_row = start_or_resume_formal_review(db_session, palace.id)
    payload = formal_review_session_payload(db_session, session_row)
    assert set(payload["frozen_due_node_uids"]) == {"a"}

    # b becomes due while session open — must NOT auto-join.
    b = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )
    b.due_at = utc_now_naive() - timedelta(minutes=1)
    b.raw_due_at = b.due_at
    db_session.commit()

    payload2 = formal_review_session_payload(db_session, session_row)
    assert set(payload2["frozen_due_node_uids"]) == {"a"}
    assert "b" in set(payload2.get("mergeable_node_uids") or [])

    wave_id = payload2["wave_id"]
    merge_new_due_into_wave(db_session, wave_id, node_uids=["b"])
    db_session.commit()
    assert get_formal_review_scope(db_session, session_row.id, palace.id) == {"a", "b"}
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id=session_row.id,
        operation_id="merged-b",
        rating_scope="single",
    )


def test_weak_rating_goes_to_reinforcement_not_formal_due(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=session_row.id,
        operation_id="wave-again-a",
        rating_scope="single",
    )
    state = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    assert state.schedule_source == "reinforcement"
    assert state.schedule_reason == "reinforcement_r1_batch"
    waves = (
        db_session.query(ReviewWave)
        .filter_by(palace_id=palace.id, wave_type="same_day_reinforcement")
        .all()
    )
    assert len(waves) >= 1
    reinforcement_item = (
        db_session.query(ReviewWaveItem)
        .filter_by(wave_id=state.effective_wave_id, node_uid="a")
        .one()
    )
    assert reinforcement_item.status == "pending_reinforcement"
    assert reinforcement_item.rating is None
    # Not formal-due after forget
    assert "a" not in formal_due_node_uids(db_session, palace.id)


def test_reinforcement_nodes_still_expose_next_review_at(db_session):
    """Reinforcement-only schedule must still expose catalog next_review_at."""
    from memory_anki.modules.memory.application.node_memory_projection import (
        get_palace_due_rollup,
    )

    palace = _seed_palace(db_session, node_uids=["a", "b"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    for uid in ("a", "b"):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid=uid,
            rating=2,
            study_session_id=session_row.id,
            operation_id=f"wave-hard-{uid}",
            rating_scope="single",
        )

    rollup = get_palace_due_rollup(db_session, palace.id)
    assert rollup["next_review_at"] is not None
    assert rollup["mastery_percent"] > 0
    assert rollup["due_node_count"] == 0
    assert rollup["has_due_review"] is False
    # All nodes parked on reinforcement — catalog must still show a schedule.
    assert all(
        item.get("schedule_source") == "reinforcement"
        for item in (rollup.get("nodes") or [])
    )


def test_strong_rating_leaves_future_wave_item_pending(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    source_wave_id = formal_review_session_payload(db_session, session_row)["wave_id"]
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=3,
        study_session_id=session_row.id,
        operation_id="wave-good-a",
        rating_scope="single",
    )
    state = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="a"
    ).one()
    source_item = db_session.query(ReviewWaveItem).filter_by(
        wave_id=source_wave_id, node_uid="a"
    ).one()
    target_item = db_session.query(ReviewWaveItem).filter_by(
        wave_id=state.effective_wave_id, node_uid="a"
    ).one()
    assert source_item.status == "rated_direct"
    if state.effective_wave_id != source_wave_id:
        assert target_item.status == "pending"
        assert target_item.rating is None


def test_rating_undo_restores_source_and_removes_target_membership(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    source_wave_id = formal_review_session_payload(db_session, session_row)["wave_id"]
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=session_row.id,
        operation_id="undo-wave-a",
        rating_scope="single",
    )
    target_wave_id = db_session.query(ReviewNodeState.effective_wave_id).filter_by(
        palace_id=palace.id, node_uid="a"
    ).scalar()
    undo_rating_operation(
        db_session,
        operation_id="undo-wave-a",
        study_session_id=session_row.id,
    )
    source_item = db_session.query(ReviewWaveItem).filter_by(
        wave_id=source_wave_id, node_uid="a"
    ).one()
    assert source_item.status == "pending"
    assert source_item.rating_operation_id is None
    if target_wave_id != source_wave_id:
        assert (
            db_session.query(ReviewWaveItem)
            .filter_by(wave_id=target_wave_id, node_uid="a")
            .first()
            is None
        )


def test_complete_receipt_includes_pending_reinforcement(db_session):
    """Formal complete exposes the next restudy batch for auto-chain."""
    palace = _seed_palace(db_session, node_uids=["a", "b"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=session_row.id,
        operation_id="complete-again-a",
        rating_scope="single",
    )
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="b",
        rating=3,
        study_session_id=session_row.id,
        operation_id="complete-good-b",
        rating_scope="single",
    )
    receipt = complete_formal_review(
        db_session,
        session_row,
        duration_seconds=20,
        completion_mode="manual_complete",
        note="",
        chapter_id=None,
    )
    pending = receipt.get("pending_reinforcement")
    assert pending is not None
    assert pending["pending_count"] >= 1
    assert pending["wave_id"]
    state = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    assert pending["wave_id"] == state.effective_wave_id


def test_reinforcement_wave_can_start_as_review_session(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    formal_session = start_or_resume_formal_review(db_session, palace.id)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=formal_session.id,
        operation_id="reinforcement-start-a",
        rating_scope="single",
    )
    state = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="a"
    ).one()
    wave = db_session.get(ReviewWave, state.effective_wave_id)
    # Immediate restudy: available_at is already due (no clock wait).
    assert wave is not None
    assert wave.available_at is not None
    assert wave.available_at <= utc_now_naive()
    reinforcement_session = start_reinforcement_wave_session(db_session, wave.id)
    assert reinforcement_session.scene == "reinforcement_review"
    assert get_formal_review_scope(
        db_session, reinforcement_session.id, palace.id
    ) == {"a"}


def test_freestyle_includes_available_reinforcement_nodes(db_session):
    """Same-day restudy is freestyle-actionable immediately (no clock wait)."""
    from memory_anki.modules.memory.application.node_memory_service import (
        due_node_uids_for_entry,
        list_due_nodes,
    )
    from memory_anki.modules.practice.application.queue_service import build_freestyle_queue

    palace = _seed_palace(db_session, node_uids=["a"])
    formal_session = start_or_resume_formal_review(db_session, palace.id)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="a",
        rating=1,
        study_session_id=formal_session.id,
        operation_id="freestyle-reinforcement-a",
        rating_scope="single",
    )
    state = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="a"
    ).one()
    assert state.schedule_source == "reinforcement"
    assert state.schedule_reason == "reinforcement_r1_batch"

    # Formal queue still excludes reinforcement.
    assert "a" not in list_due_nodes(db_session, palace.id)
    assert "a" not in formal_due_node_uids(db_session, palace.id)

    # Freestyle due set includes immediately available restudy.
    assert "a" in list_due_nodes(db_session, palace.id, include_reinforcement=True)

    # Unit-scoped freeze (freestyle card start) accepts reinforcement UIDs.
    frozen = due_node_uids_for_entry(
        db_session,
        palace.id,
        entry_mode="node",
        scope_node_uids=["a"],
    )
    assert frozen == ["a"]

    # Immersive queue emits a mindmap card for the reinforcement-only palace.
    queue = build_freestyle_queue(
        db_session,
        config_raw={
            "specific_palace_ids": [palace.id],
            "content": {"mindmap_branch": True, "quiz_question": False},
            "queue_length": 10,
            "seed": 1,
        },
        operation_id="op-freestyle-reinforcement",
    )
    mindmap = [c for c in queue["cards"] if c.get("type") == "mindmap_branch"]
    assert mindmap, queue
    assert any("a" in (c.get("due_node_uids") or []) for c in mindmap)


def test_freestyle_calendar_today_due_opt_in(db_session):
    """Later-today formal due enters freestyle only when include_calendar_today_due."""
    from memory_anki.modules.memory.application.node_memory_service import (
        due_node_uids_for_entry,
        list_due_nodes,
    )
    from memory_anki.modules.memory.application.wave_policy import local_date_of
    from memory_anki.modules.practice.application.queue_service import build_freestyle_queue

    palace = _seed_palace(db_session, node_uids=["a"])
    now = utc_now_naive()
    # Schedule due this evening (still same local calendar day if now is not too late).
    later_today = now + timedelta(hours=6)
    if local_date_of(later_today) != local_date_of(now):
        # Near midnight: keep a short offset that still lands on local today.
        later_today = now + timedelta(minutes=30)
        if local_date_of(later_today) != local_date_of(now):
            later_today = now + timedelta(seconds=5)
    state = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    state.due_at = later_today
    state.raw_due_at = later_today
    state.last_review_at = now - timedelta(days=3)
    state.schedule_source = "manual"
    db_session.commit()

    assert "a" not in list_due_nodes(db_session, palace.id)
    assert "a" not in list_due_nodes(
        db_session, palace.id, include_reinforcement=True
    )
    assert "a" in list_due_nodes(
        db_session,
        palace.id,
        include_calendar_today_due=True,
    )

    # Scoped freestyle freeze can rate the calendar-today node.
    assert due_node_uids_for_entry(
        db_session,
        palace.id,
        entry_mode="node",
        scope_node_uids=["a"],
    ) == ["a"]

    queue_off = build_freestyle_queue(
        db_session,
        config_raw={
            "specific_palace_ids": [palace.id],
            "content": {"mindmap_branch": True, "quiz_question": False},
            "include_calendar_today_due": False,
            "queue_length": 10,
            "seed": 1,
        },
        operation_id="op-calendar-off",
    )
    mindmap_off = [c for c in queue_off["cards"] if c.get("type") == "mindmap_branch"]
    assert not any("a" in (c.get("due_node_uids") or []) for c in mindmap_off)

    queue_on = build_freestyle_queue(
        db_session,
        config_raw={
            "specific_palace_ids": [palace.id],
            "content": {"mindmap_branch": True, "quiz_question": False},
            "include_calendar_today_due": True,
            "queue_length": 10,
            "seed": 1,
        },
        operation_id="op-calendar-on",
    )
    mindmap_on = [c for c in queue_on["cards"] if c.get("type") == "mindmap_branch"]
    assert mindmap_on, queue_on
    assert any("a" in (c.get("due_node_uids") or []) for c in mindmap_on)

    # Tomorrow stays excluded even with opt-in.
    tomorrow = now + timedelta(days=1, hours=2)
    state = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    state.due_at = tomorrow
    state.raw_due_at = tomorrow
    db_session.commit()
    assert "a" not in list_due_nodes(
        db_session,
        palace.id,
        include_calendar_today_due=True,
    )


def test_empty_reinforcement_wave_is_cancelled_on_start(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    ghost = ReviewWave(
        id="rw-ghost-empty",
        palace_id=palace.id,
        wave_type="same_day_reinforcement",
        status="scheduled",
        available_at=utc_now_naive() - timedelta(minutes=1),
        item_count=0,
        rated_count=0,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db_session.add(ghost)
    db_session.commit()
    try:
        start_reinforcement_wave_session(db_session, ghost.id)
        raise AssertionError("expected empty reinforcement start to fail")
    except ValueError as exc:
        assert "no pending nodes" in str(exc)
    db_session.refresh(ghost)
    assert ghost.status == "cancelled"


def test_queue_hides_empty_reinforcement_waves(db_session):
    from memory_anki.modules.memory.application.formal_review_service import (
        get_fsrs_queue_payload,
    )

    palace = _seed_palace(db_session, node_uids=["a"])
    ghost = ReviewWave(
        id="rw-ghost-queue",
        palace_id=palace.id,
        wave_type="same_day_reinforcement",
        status="scheduled",
        available_at=utc_now_naive() - timedelta(minutes=1),
        item_count=0,
        rated_count=0,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db_session.add(ghost)
    db_session.commit()
    payload = get_fsrs_queue_payload(db_session, include_stats=False, include_items=True)
    ids = {wave["id"] for wave in payload.get("reinforcement_waves") or []}
    assert "rw-ghost-queue" not in ids


def test_baseline_calibration_undo_restores_wave_membership(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    formal_session = start_or_resume_formal_review(db_session, palace.id)
    wave_id = formal_review_session_payload(db_session, formal_session)["wave_id"]
    preview_or_apply_calibration(
        db_session,
        palace_id=palace.id,
        operation_id="calibrate-new-a",
        mode="baseline",
        scope_kind="nodes",
        scope={"node_uids": ["a"]},
        baseline_tier="new",
        confirm=True,
    )
    assert (
        db_session.query(ReviewWaveItem)
        .filter_by(wave_id=wave_id, node_uid="a")
        .first()
        is None
    )
    undo_calibration(db_session, operation_id="calibrate-new-a", palace_id=palace.id)
    restored = db_session.query(ReviewWaveItem).filter_by(
        wave_id=wave_id, node_uid="a"
    ).one()
    assert restored.status == "pending"


def test_diagnose_includes_per_node_progress(db_session):
    palace = _seed_palace(db_session, node_uids=["a", "b"])
    diag = diagnose_palace(db_session, palace.id)
    assert diag["palace_id"] == palace.id
    nodes = diag.get("nodes") or []
    assert {n["node_uid"] for n in nodes} == {"a", "b"}
    for node in nodes:
        assert "progress_label" in node
        assert "stability_days" in node
        assert "text" in node


def test_match_node_calibration_copies_progress(db_session):
    palace = _seed_palace(db_session, node_uids=["a", "b", "c"])
    strong_due = utc_now_naive() + timedelta(days=30)
    a = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    a.stability = 30.0
    a.difficulty = 3.0
    a.due_at = strong_due
    a.raw_due_at = strong_due
    a.last_review_at = utc_now_naive() - timedelta(days=1)
    b = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )
    b.stability = 1.0
    b.difficulty = 7.0
    db_session.commit()

    result = preview_or_apply_calibration(
        db_session,
        palace_id=palace.id,
        operation_id="match-a-to-b",
        mode="match_node",
        scope_kind="nodes",
        scope={"node_uids": ["b", "c"], "source_node_uid": "a"},
        source_node_uid="a",
        confirm=True,
    )
    assert result["affected_node_count"] == 2
    assert result["source_node_uid"] == "a"

    b = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="b")
        .one()
    )
    c = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="c")
        .one()
    )
    a = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="a")
        .one()
    )
    assert b.stability == a.stability == 30.0
    assert c.stability == 30.0
    assert b.difficulty == a.difficulty
    assert c.difficulty == a.difficulty
    assert b.schedule_source == "calibrated"
    assert (b.schedule_reason or "").startswith("match_node:a")


def test_pause_wave(db_session):
    palace = _seed_palace(db_session, node_uids=["a"])
    session_row = start_or_resume_formal_review(db_session, palace.id)
    payload = formal_review_session_payload(db_session, session_row)
    wave = pause_formal_wave(db_session, payload["wave_id"])
    db_session.commit()
    assert wave.status == "paused"


def test_unlearned_nodes_enter_formal_due(db_session):
    """Brand-new palace nodes (no FSRS rows) freeze as first-learn formal due."""
    palace = Palace(
        title="New only",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {"data": {"uid": "x", "text": "X"}, "children": []},
                    ],
                }
            }
        ),
    )
    db_session.add(palace)
    db_session.commit()
    assert formal_due_node_uids(db_session, palace.id) == ["x"]
    row = start_or_resume_formal_review(db_session, palace.id)
    payload = formal_review_session_payload(db_session, row)
    assert set(payload["frozen_due_node_uids"]) == {"x"}

def test_future_formal_schedule_exposes_next_review_at(db_session):
    """Not-yet-due formal nodes must still surface next_review_at on catalog."""
    from memory_anki.modules.memory.application.node_memory_projection import (
        get_palace_due_rollup,
    )

    palace = _seed_palace(db_session, node_uids=["a", "b"])
    future = utc_now_naive() + timedelta(days=5)
    for uid in ("a", "b"):
        row = (
            db_session.query(ReviewNodeState)
            .filter_by(palace_id=palace.id, node_uid=uid)
            .one()
        )
        row.due_at = future
        row.raw_due_at = future
        row.schedule_source = "manual"
    db_session.commit()

    rollup = get_palace_due_rollup(db_session, palace.id)
    assert rollup["due_node_count"] == 0
    assert rollup["has_due_review"] is False
    assert rollup["next_review_at"] is not None

