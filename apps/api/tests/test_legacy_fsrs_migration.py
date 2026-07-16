import json
from datetime import date, datetime

from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.reviews.application.legacy_migration import (
    migrate_legacy_node_states,
    repair_legacy_node_due_dates,
)


def _palace(session, *, title: str = "Legacy") -> Palace:
    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {"data": {"uid": "a", "text": "A"}, "children": []},
                {"data": {"uid": "b", "text": "B"}, "children": []},
            ],
        }
    }
    palace = Palace(
        title=title,
        description="",
        difficulty=0,
        review_mode="review",
        editor_doc=json.dumps(document),
        created_at=datetime(2026, 7, 10, 9, 15),
    )
    session.add(palace)
    session.flush()
    return palace


def _state(palace_id: int, node_uid: str, due_at: datetime, source: str) -> ReviewNodeState:
    return ReviewNodeState(
        palace_id=palace_id,
        node_uid=node_uid,
        state=2,
        stability=3.0,
        difficulty=5.0,
        due_at=due_at,
        last_review_at=datetime(2026, 7, 10, 9, 15),
        content_fingerprint=node_uid,
        state_source=source,
    )


def test_repair_realigns_only_legacy_estimates_in_mixed_palace(db_session):
    palace = _palace(db_session)
    pending_at = datetime(2026, 7, 22, 22, 37)
    db_session.add(
        ReviewSchedule(
            palace_id=palace.id,
            scheduled_date=pending_at.date(),
            scheduled_at=pending_at,
            review_number=2,
            review_type="standard",
            completed=False,
        )
    )
    legacy = _state(palace.id, "a", datetime(2026, 7, 15, 8, 0), "legacy_estimate")
    manual_due = datetime(2026, 8, 5, 12, 0)
    manual = _state(palace.id, "b", manual_due, "manual")
    db_session.add_all([legacy, manual])
    db_session.commit()

    result = repair_legacy_node_due_dates(db_session, palace_id=palace.id)

    db_session.refresh(legacy)
    db_session.refresh(manual)
    assert result == {"updated": 1, "skipped_palaces": 0}
    assert legacy.due_at == pending_at
    assert manual.due_at == manual_due
    assert manual.stability == 3.0
    assert manual.difficulty == 5.0


def test_repair_skips_palace_without_pending_legacy_schedule(db_session):
    palace = _palace(db_session)
    original_due = datetime(2026, 8, 1, 9, 0)
    state = _state(palace.id, "a", original_due, "legacy_estimate")
    db_session.add_all(
        [
            state,
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=date(2026, 7, 12),
                scheduled_at=datetime(2026, 7, 12, 9, 15),
                review_number=0,
                review_type="standard",
                completed=True,
                completed_at=datetime(2026, 7, 12, 9, 20),
            ),
        ]
    )
    db_session.commit()

    result = repair_legacy_node_due_dates(db_session, palace_id=palace.id)

    db_session.refresh(state)
    assert result == {"updated": 0, "skipped_palaces": 1}
    assert state.due_at == original_due


def test_migrate_legacy_states_uses_first_pending_schedule_due(db_session):
    palace = _palace(db_session)
    first_pending = datetime(2026, 7, 17, 14, 48)
    db_session.add_all(
        [
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=date(2026, 7, 12),
                scheduled_at=datetime(2026, 7, 12, 9, 15),
                interval_days=2,
                review_number=0,
                review_type="standard",
                completed=True,
                completed_at=datetime(2026, 7, 12, 9, 20),
            ),
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=first_pending.date(),
                scheduled_at=first_pending,
                interval_days=5,
                review_number=1,
                review_type="standard",
                completed=False,
            ),
        ]
    )
    db_session.commit()

    result = migrate_legacy_node_states(db_session, palace_id=palace.id)
    states = db_session.query(ReviewNodeState).filter_by(palace_id=palace.id).all()

    assert result == {"created": 2, "skipped": 0}
    assert {row.node_uid for row in states} == {"a", "b"}
    assert {row.due_at for row in states} == {first_pending}
    assert {row.state_source for row in states} == {"legacy_estimate"}


def test_migrate_legacy_states_does_not_guess_without_pending_schedule(db_session):
    palace = _palace(db_session)
    db_session.commit()

    result = migrate_legacy_node_states(db_session, palace_id=palace.id)

    assert result == {"created": 0, "skipped": 0}
    assert db_session.query(ReviewNodeState).filter_by(palace_id=palace.id).count() == 0
