from __future__ import annotations

from datetime import date, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def _seed_overdue_schedule(session_factory) -> tuple[int, date]:
    old_date = date.today() - timedelta(days=5)
    with session_factory() as session:
        palace = Palace(title="Spread Owner", description="")
        session.add(palace)
        session.flush()
        session.add_all(
            [
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=old_date - timedelta(days=1),
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=True,
                    review_number=0,
                    review_type="standard",
                ),
                ReviewSchedule(
                    palace_id=palace.id,
                    scheduled_date=old_date,
                    interval_days=1,
                    algorithm_used="ebbinghaus",
                    completed=False,
                    review_number=1,
                    review_type="standard",
                ),
            ]
        )
        session.commit()
        pending = (
            session.query(ReviewSchedule)
            .filter_by(palace_id=palace.id, completed=False)
            .one()
        )
        return pending.id, old_date


def test_spread_overdue_mutation_store_failure_rolls_back_moves_and_undo_snapshot(
    make_client, session_factory, monkeypatch
):
    schedule_id, old_date = _seed_overdue_schedule(session_factory)
    monkeypatch.setattr(
        review_router.SqlAlchemyMutationResponseStore,
        "save",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("cache failed")),
    )
    client = make_client(review_router)

    with pytest.raises(RuntimeError, match="cache failed"):
        client.post(
            "/api/v1/review/spread-overdue",
            json={"days": 7},
            headers={MUTATION_ID_HEADER: "spread-rollback"},
        )

    with session_factory() as session:
        assert session.get(ReviewSchedule, schedule_id).scheduled_date == old_date
        assert session.query(Config).filter_by(key="overdue_spread_undo_snapshot").first() is None


def test_spread_overdue_replay_returns_cached_result_without_second_mutation(
    make_client, session_factory
):
    schedule_id, _ = _seed_overdue_schedule(session_factory)
    client = make_client(review_router)
    headers = {MUTATION_ID_HEADER: "spread-replay"}

    first = client.post(
        "/api/v1/review/spread-overdue", json={"days": 7}, headers=headers
    )
    with session_factory() as session:
        first_date = session.get(ReviewSchedule, schedule_id).scheduled_date
    second = client.post(
        "/api/v1/review/spread-overdue", json={"days": 1}, headers=headers
    )

    assert first.status_code == 200
    assert second.json() == first.json()
    with session_factory() as session:
        assert session.get(ReviewSchedule, schedule_id).scheduled_date == first_date
