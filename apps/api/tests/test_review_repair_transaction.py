from __future__ import annotations

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.modules.reviews.application import review_repair_service
from memory_anki.modules.reviews.presentation import router as review_router


def test_review_repair_failure_rolls_back_rebuilt_schedules(
    make_client,
    session_factory,
    monkeypatch,
):
    with session_factory() as session:
        palace = Palace(title="Repair Owner", description="")
        session.add(palace)
        session.commit()
        palace_id = palace.id

    monkeypatch.setattr(
        review_repair_service,
        "_migrate_orphan_review_progress",
        lambda session: (_ for _ in ()).throw(RuntimeError("migration failed")),
    )
    client = make_client(review_router)

    with pytest.raises(RuntimeError, match="migration failed"):
        client.post("/api/v1/review/repair-stage-progress")

    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace is not None
        assert palace.mastered is False
        assert session.query(ReviewSchedule).filter_by(palace_id=palace_id).count() == 0
